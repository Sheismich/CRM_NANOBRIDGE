import { and, desc, eq, ne, sql } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, envios, prospectos } from "../database/schema.js";
import { bloquearPersona, personaEnBaja } from "./baja-prospecto.js";
import { ESTADOS_PROSPECTO_CERRADO, MESES_ENFRIAMIENTO } from "./ciclo-contacto.js";
import { frenarOtrasCampanas } from "./clasificacion-respuesta.js";

// Acción de auditoría; ActividadesService la enseña en el Historial de la
// ficha y el Registro de cambios la nombra «Seguimiento detenido».
export const ACCION_DETENER_SEGUIMIENTO = "detener_seguimiento";

export type SeguimientoDetenido =
  // Tenía una serie en curso: ese prospecto pasó a interesado.
  | { como: "serie"; prospecto_id: number }
  // Solo esperaba en la fila: regresó a capturado.
  | { como: "fila"; prospecto_ids: number[] };

const CERRADOS = sql.join(ESTADOS_PROSPECTO_CERRADO.map((e) => sql`${e}`), sql`, `);

/**
 * «Detener seguimiento» (pendiente #1 de la revisión del 20-nov-2026, decidido
 * por Fabián el 23-nov): la persona ya habla con ventas por teléfono, WhatsApp
 * u otro correo, así que la automatización deja de escribirle.
 *
 * - Si tiene una serie en curso (el prospecto abierto con el envío más reciente
 *   de los últimos 6 meses), ese prospecto pasa a `interesado`. Es un estado
 *   cerrado: PT4 no le manda nada, frenarOtrasCampanas cierra sus ventanas en
 *   las demás campañas y lo saca de sus filas, y no puede volver a entrar a otra
 *   mientras siga así. Su propia ventana también se cierra: nadie contestó.
 * - Si no tiene serie pero espera en la fila, solo sale de la fila.
 * - No crea la tarea «Contactar prospecto interesado» (ventas ya la atiende) y
 *   no toca las respuestas: los reportes cuentan interesados por respuesta.
 *
 * Con `prospectoId` solo mira ese prospecto (oportunidad creada desde él).
 * Devuelve null si no había nada que detener o si la persona está en baja (la
 * baja ya detuvo todo). Corre dentro de la transacción de quien llama.
 */
export async function detenerSeguimiento(
  tx: DrizzleTx,
  contactoId: number,
  origen: { motivo: string; usuarioId: number; prospectoId?: number }
): Promise<SeguimientoDetenido | null> {
  // La persona antes que sus prospectos (ver bloquearPersona).
  await bloquearPersona(tx, contactoId);
  if (await personaEnBaja(tx, contactoId)) return null;

  const deLaPersona = and(eq(prospectos.contactoId, contactoId), origen.prospectoId ? eq(prospectos.id, origen.prospectoId) : undefined);
  const [serie] = await tx
    .select({ id: prospectos.id, estado: prospectos.estado, campanaId: prospectos.campanaId })
    .from(prospectos)
    .innerJoin(envios, eq(envios.prospectoId, prospectos.id))
    .where(and(
      deLaPersona,
      sql`${prospectos.estado} NOT IN (${CERRADOS})`,
      ne(envios.estado, "fallido"),
      sql`${envios.enviadoEn} > CURRENT_TIMESTAMP - INTERVAL ${sql.raw(String(MESES_ENFRIAMIENTO))} MONTH`
    ))
    .orderBy(desc(envios.enviadoEn), desc(envios.id))
    .limit(1)
    .for("update");

  if (serie) {
    await tx.update(prospectos).set({ estado: "interesado" }).where(eq(prospectos.id, serie.id));
    await tx.insert(auditoria).values({
      usuarioId: origen.usuarioId,
      entidad: "prospecto",
      entidadId: serie.id,
      accion: ACCION_DETENER_SEGUIMIENTO,
      antes: { estado: serie.estado },
      despues: { estado: "interesado", motivo: origen.motivo }
    });
    await tx.update(envios).set({ ventanaEstado: "cerrada" }).where(and(eq(envios.prospectoId, serie.id), eq(envios.ventanaEstado, "abierta")));
    await frenarOtrasCampanas(tx, serie.id, contactoId, serie.campanaId, origen.usuarioId, `Se detuvo su seguimiento: ${origen.motivo}`.slice(0, 255));
    return { como: "serie", prospecto_id: serie.id };
  }

  const enFila = await tx
    .select({ id: prospectos.id, filaEstadoPrevio: prospectos.filaEstadoPrevio })
    .from(prospectos)
    .where(and(deLaPersona, eq(prospectos.estado, "en_fila")))
    .for("update");
  if (enFila.length === 0) return null;
  for (const p of enFila) {
    await tx.update(prospectos).set({ estado: "capturado", filaDesde: null, filaPor: null, filaTomadoEn: null, filaExecutionId: null, filaEstadoPrevio: null }).where(eq(prospectos.id, p.id));
    await tx.insert(auditoria).values({
      usuarioId: origen.usuarioId,
      entidad: "prospecto",
      entidadId: p.id,
      accion: ACCION_DETENER_SEGUIMIENTO,
      antes: { estado: "en_fila", estado_previo: p.filaEstadoPrevio },
      despues: { estado: "capturado", motivo: origen.motivo }
    });
  }
  return { como: "fila", prospecto_ids: enFila.map((p) => p.id) };
}
