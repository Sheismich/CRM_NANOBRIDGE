import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, empresas, eventosSendgrid, listaSupresion, mediosContacto, prospectos } from "../database/schema.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { HttpError } from "./http-error.js";
import { bloquearPersona } from "./baja-prospecto.js";
import { ESTADOS_PROSPECTO_CERRADO } from "./ciclo-contacto.js";
import { normalizeEmail } from "./normalize.js";

// Rebotes de SendGrid (044, 20-nov-2026). Un rebote desactiva SOLO al
// prospecto al que se le mandó ese correo: los otros prospectos de la persona
// y sus otros correos no se tocan (la fila y la supresión del correo ya los
// frenan). No es una baja: la persona no pidió nada, así que no se cancelan
// sus seguimientos ni se suprimen sus otros medios.
export const ESTADO_REBOTADO = "rebotado";

export type TipoRebote = "duro" | "suave";

/**
 * Pasa un prospecto a "rebotado" con el tipo, el motivo y la fecha del
 * rebote. Solo si no estaba ya cerrado (en baja, interesado, rebotado...):
 * esos se quedan como están, y el evento queda de todos modos en
 * eventos_sendgrid. Devuelve si cambió.
 *
 * Bloquea primero a la persona (orden de bloqueo de baja-prospecto.ts:
 * persona antes que sus prospectos).
 */
export async function marcarRebotado(tx: DrizzleTx, prospectoId: number, rebote: { tipo: TipoRebote; motivo: string | null; fecha: Date }) {
  const [p] = await tx.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
  if (!p) return false;
  await bloquearPersona(tx, p.contactoId);
  const [antes] = await tx.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId)).for("update");
  if (!antes || ESTADOS_PROSPECTO_CERRADO.includes(antes.estado)) return false;

  const motivo = rebote.motivo ? rebote.motivo.slice(0, 300) : null;
  await tx.update(prospectos).set({
    estado: ESTADO_REBOTADO,
    tipoRebote: rebote.tipo,
    motivoRebote: motivo,
    fechaRebote: rebote.fecha,
    estadoPrevioRebote: antes.estado
  }).where(eq(prospectos.id, prospectoId));
  await tx.insert(auditoria).values({
    usuarioId: null,
    entidad: "prospecto",
    entidadId: prospectoId,
    accion: "rebote",
    antes: { estado: antes.estado },
    despues: { estado: ESTADO_REBOTADO, tipo_rebote: rebote.tipo, motivo }
  });
  return true;
}

// El correo al que rebotó: el del evento que lo desactivó.
function correoDelRebote(prospectoId: unknown) {
  return sql<string | null>`(SELECT ${eventosSendgrid.correo} FROM ${eventosSendgrid} WHERE ${eventosSendgrid.prospectoId} = ${prospectoId} AND ${eventosSendgrid.resultado} = 'desactivado' ORDER BY ${eventosSendgrid.id} DESC LIMIT 1)`;
}

export async function listarRebotados(db: DrizzleDb, dias: number) {
  const filas = await db
    .select({
      prospecto_id: prospectos.id,
      correo: correoDelRebote(prospectos.id),
      contacto: contactos.nombre,
      empresa: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
      campana: campanas.nombre,
      tipo_rebote: prospectos.tipoRebote,
      motivo_rebote: prospectos.motivoRebote,
      fecha_rebote: prospectos.fechaRebote
    })
    .from(prospectos)
    .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
    .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
    .leftJoin(campanas, eq(campanas.id, prospectos.campanaId))
    .where(and(eq(prospectos.estado, ESTADO_REBOTADO), gte(prospectos.fechaRebote, sql`CURRENT_TIMESTAMP - INTERVAL ${dias} DAY`)))
    .orderBy(desc(prospectos.fechaRebote), desc(prospectos.id))
    .limit(200);
  return filas.map((f) => ({ ...f, fecha_rebote: f.fecha_rebote ? new Date(f.fecha_rebote).toISOString() : null }));
}

/**
 * Reactiva a un prospecto rebotado (por ejemplo, corrigieron un typo en el
 * correo). Queda "capturado", para que se pueda volver a mandar a
 * automatización. Si fue un rebote duro, saca el correo de la lista de
 * supresión y vuelve a dejar el medio activo, SOLO si esa supresión es de un
 * rebote: una baja o una queja de spam nunca se deshacen desde aquí.
 *
 * SendGrid guarda su propia lista de Bounces y no le vuelve a mandar a ese
 * correo hasta que se quite de ahí: la llave de la API solo tiene permiso de
 * Mail Send, así que eso se hace a mano (quitar_de_sendgrid en la respuesta).
 */
export async function reactivarRebote(db: DrizzleDb, prospectoId: number, actor: CurrentUser) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
    if (!p) throw new HttpError(404, "El prospecto no existe");
    await bloquearPersona(tx, p.contactoId);
    const [antes] = await tx
      .select({ estado: prospectos.estado, tipoRebote: prospectos.tipoRebote, motivoRebote: prospectos.motivoRebote, correo: correoDelRebote(prospectoId) })
      .from(prospectos)
      .where(eq(prospectos.id, prospectoId))
      .for("update");
    if (!antes || antes.estado !== ESTADO_REBOTADO) throw new HttpError(409, "El prospecto no está rebotado", "PROSPECTO_NO_REBOTADO");

    let supresionQuitada = false;
    if (antes.tipoRebote === "duro" && antes.correo) {
      const valorNormalizado = normalizeEmail(antes.correo);
      const [borrado] = await tx.delete(listaSupresion).where(and(eq(listaSupresion.tipo, "correo"), eq(listaSupresion.valorNormalizado, valorNormalizado), eq(listaSupresion.evento, "bounce")));
      supresionQuitada = borrado.affectedRows > 0;
      if (supresionQuitada) {
        await tx.update(mediosContacto).set({ estadoContacto: "activo" }).where(and(eq(mediosContacto.tipo, "correo"), eq(mediosContacto.valorNormalizado, valorNormalizado), eq(mediosContacto.estadoContacto, "no_contactar")));
      }
    }

    await tx.update(prospectos).set({ estado: "capturado", tipoRebote: null, motivoRebote: null, fechaRebote: null, estadoPrevioRebote: null }).where(eq(prospectos.id, prospectoId));
    await tx.insert(auditoria).values({
      usuarioId: actor.id,
      entidad: "prospecto",
      entidadId: prospectoId,
      accion: "reactivar_rebote",
      antes: { estado: antes.estado, tipo_rebote: antes.tipoRebote, motivo: antes.motivoRebote, correo: antes.correo },
      despues: { estado: "capturado", supresion_quitada: supresionQuitada }
    });

    return { prospecto_id: prospectoId, estado: "capturado", supresion_quitada: supresionQuitada, quitar_de_sendgrid: supresionQuitada ? antes.correo : null };
  });
}

// Cuántos rebotes suaves seguidos lleva un prospecto: correos distintos con
// "blocked" después de su último "delivered", por la fecha de SendGrid. Se
// calcula desde la tabla, así que no importa en qué orden lleguen.
// Lectura con bloqueo (FOR SHARE): ve lo último confirmado aunque esta
// transacción ya tenga su "foto" (REPEATABLE READ).
export async function rebotesSuavesSeguidos(tx: DrizzleTx, prospectoId: number) {
  // El último "delivered" se busca dentro de la misma consulta: así la fecha
  // no viaja a JavaScript y de regreso (y no se mueve de zona horaria).
  const [fila] = await tx
    .select({ n: sql<number>`COUNT(DISTINCT COALESCE(CAST(${eventosSendgrid.envioId} AS CHAR), ${eventosSendgrid.sgEventId}))` })
    .from(eventosSendgrid)
    .where(and(
      eq(eventosSendgrid.prospectoId, prospectoId),
      eq(eventosSendgrid.evento, "bounce"),
      eq(eventosSendgrid.tipo, "blocked"),
      sql`${eventosSendgrid.ocurrioEn} > COALESCE((SELECT MAX(e2.ocurrio_en) FROM eventos_sendgrid e2 WHERE e2.prospecto_id = ${prospectoId} AND e2.evento = 'delivered'), '1000-01-01')`
    ))
    .for("share");
  return Number(fila?.n ?? 0);
}
