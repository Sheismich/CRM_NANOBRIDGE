import { and, count, eq, gte, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, envios, eventosSendgrid, parametrosAutomatizacion } from "../database/schema.js";
import { env } from "../config/env.js";
import { HttpError } from "./http-error.js";
import { adminsYSupervisores, notificar } from "../notificaciones/notificar.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// Freno automático del dominio: una lista mala quema un dominio nuevo. Solo
// frena la prospección: las respuestas de vendedores y las cotizaciones las
// manda una persona, a alguien que ya está en conversación. Se reanuda a
// mano; después solo cuenta lo que llegue de nuevo.
//
// Desde 044 (20-nov-2026) cuenta lo que llega por el Event Webhook directo
// (eventos_sendgrid), solo de correos de prospección (con prospecto):
// - rebotes duros (correos distintos) y prospectos desactivados por rebotes
//   suaves seguidos. Un suave suelto no cuenta.
// - quejas de spam (correos distintos).
// Pausa con FRENO_QUEJAS_7D quejas, o con FRENO_TASA_REBOTE_7D por ciento de
// rebotes sobre los correos enviados, si salieron al menos
// FRENO_MIN_ENVIOS_7D. Con menos envíos el porcentaje engaña (1 de 40 =
// 2.5%) y se queda la cuenta fija FRENO_REBOTES_7D.
const CLAVE_FRENO_DOMINIO = "freno_dominio";

export const MENSAJE_EN_PAUSA = "Envíos en pausa por el freno del dominio";
export const CODIGO_ENVIOS_EN_PAUSA = "ENVIOS_EN_PAUSA";

type Freno = { pausado: boolean; motivo: string | null; pausado_en: string | null; reanudado_en: string | null };

function aFreno(guardado: unknown): Freno {
  const valor = (guardado ?? {}) as Partial<Freno>;
  return { pausado: valor.pausado === true, motivo: valor.motivo ?? null, pausado_en: valor.pausado_en ?? null, reanudado_en: valor.reanudado_en ?? null };
}

export async function leerFreno(db: DrizzleDb | DrizzleTx): Promise<Freno> {
  const [fila] = await db.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_FRENO_DOMINIO)).limit(1);
  return aFreno(fila?.valor);
}

export type CuentaFreno = { duros: number; suaves: number; quejas: number; enviados: number };

// bloquear: lectura con bloqueo (FOR SHARE), que ve lo último confirmado y no
// la "foto" de la transacción (REPEATABLE READ). Lo usa evaluarFreno.
async function contarEventos(db: DrizzleDb | DrizzleTx, freno: Freno, bloquear = false): Promise<CuentaFreno> {
  // reanudado_en es ISO en UTC, igual que la sesión de MySQL.
  const desdeReanudar = freno.reanudado_en ? freno.reanudado_en.slice(0, 19).replace("T", " ") : null;
  const eventos = db
    .select({
      duros: sql<number>`COUNT(DISTINCT CASE WHEN ${eventosSendgrid.evento} = 'bounce' AND ${eventosSendgrid.tipo} = 'bounce' AND ${eventosSendgrid.resultado} IN ('desactivado', 'suprimido') THEN COALESCE(${eventosSendgrid.correo}, ${eventosSendgrid.sgEventId}) END)`,
      suaves: sql<number>`COUNT(DISTINCT CASE WHEN ${eventosSendgrid.evento} = 'bounce' AND ${eventosSendgrid.tipo} = 'blocked' AND ${eventosSendgrid.resultado} = 'desactivado' THEN ${eventosSendgrid.prospectoId} END)`,
      quejas: sql<number>`COUNT(DISTINCT CASE WHEN ${eventosSendgrid.evento} = 'spamreport' THEN COALESCE(${eventosSendgrid.correo}, ${eventosSendgrid.sgEventId}) END)`
    })
    .from(eventosSendgrid)
    .where(and(
      sql`${eventosSendgrid.prospectoId} IS NOT NULL`,
      gte(eventosSendgrid.recibidoEn, sql`CURRENT_TIMESTAMP - INTERVAL 7 DAY`),
      desdeReanudar ? gte(eventosSendgrid.recibidoEn, sql`${desdeReanudar}`) : undefined
    ));
  const enviados = db
    .select({ n: count() })
    .from(envios)
    .where(and(
      eq(envios.canal, "correo"),
      eq(envios.estado, "enviado"),
      gte(envios.enviadoEn, sql`CURRENT_TIMESTAMP - INTERVAL 7 DAY`),
      desdeReanudar ? gte(envios.enviadoEn, sql`${desdeReanudar}`) : undefined
    ));
  // Los envíos se leen sin bloqueo: un FOR SHARE sobre ese rango frenaría
  // el registro de envíos nuevos mientras dura la transacción, y que la
  // cuenta se quede atrás por un correo no cambia nada.
  const [e] = await (bloquear ? eventos.for("share") : eventos);
  const [s] = await enviados;
  return { duros: Number(e?.duros ?? 0), suaves: Number(e?.suaves ?? 0), quejas: Number(e?.quejas ?? 0), enviados: Number(s?.n ?? 0) };
}

// Tasa en por ciento con un decimal; null sin envíos.
export function tasaDeRebote(c: CuentaFreno): number | null {
  if (c.enviados === 0) return null;
  return Math.round(((c.duros + c.suaves) / c.enviados) * 1000) / 10;
}

// Por qué se pausa, o null si no toca. Pura: la usan evaluarFreno y las pruebas.
export function motivoDePausa(c: CuentaFreno): string | null {
  if (c.quejas >= env.FRENO_QUEJAS_7D) return `Llegaron ${c.quejas} quejas de spam en 7 días.`;
  const rebotes = c.duros + c.suaves;
  if (c.enviados >= env.FRENO_MIN_ENVIOS_7D) {
    if ((rebotes / c.enviados) * 100 >= env.FRENO_TASA_REBOTE_7D) {
      return `Rebotó el ${tasaDeRebote(c)}% de los correos (${rebotes} de ${c.enviados}) en 7 días.`;
    }
    return null;
  }
  return rebotes >= env.FRENO_REBOTES_7D ? `Llegaron ${rebotes} rebotes en 7 días.` : null;
}

async function guardar(tx: DrizzleTx, valor: Freno) {
  await tx
    .insert(parametrosAutomatizacion)
    .values({ clave: CLAVE_FRENO_DOMINIO, valor, descripcion: "Freno automatico del dominio; se reanuda en Administracion" })
    .onDuplicateKeyUpdate({ set: { valor } });
}

// Forma a los eventos que cuentan para el freno. Quien guarda una queja o un
// rebote lo pide ANTES de guardarlo (sendgrid-eventos): dos eventos que
// llegan juntos se forman desde aquí. Si cada uno guardaba primero y luego
// pedía el bloqueo, se trababan (deadlock).
export async function bloquearFreno(tx: DrizzleTx) {
  const [fila] = await tx.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_FRENO_DOMINIO)).for("update");
  return aFreno(fila?.valor);
}

// Las lecturas son con bloqueo: si la transacción ya había leído algo antes
// de esperar el FOR UPDATE, una lectura normal seguiría viendo su foto de
// entonces, sin el rebote que el otro evento acaba de confirmar.
export async function evaluarFreno(tx: DrizzleTx) {
  const freno = await bloquearFreno(tx);
  if (freno.pausado) return;

  const cuenta = await contarEventos(tx, freno, true);
  const motivo = motivoDePausa(cuenta);
  if (!motivo) return;

  await guardar(tx, { ...freno, pausado: true, motivo, pausado_en: new Date().toISOString() });
  await tx.insert(auditoria).values({ usuarioId: null, entidad: CLAVE_FRENO_DOMINIO, entidadId: 0, accion: "pausar", despues: { motivo, ...cuenta, tasa: tasaDeRebote(cuenta) } });
  await notificar(tx, await adminsYSupervisores(tx), {
    tipo: "freno_dominio",
    titulo: "Se pausaron los envíos de prospección",
    cuerpo: `${motivo} Revisa la lista antes de reanudar en Administración.`,
    enlace: "/administracion",
    entidad: CLAVE_FRENO_DOMINIO,
    conCorreo: true
  });
}

export async function reanudarFreno(db: DrizzleDb, actor: CurrentUser) {
  await db.transaction(async (tx) => {
    const freno = await leerFreno(tx);
    if (!freno.pausado) throw new HttpError(409, "Los envíos no están en pausa");
    await guardar(tx, { pausado: false, motivo: null, pausado_en: null, reanudado_en: new Date().toISOString() });
    await tx.insert(auditoria).values({ usuarioId: actor.id, entidad: CLAVE_FRENO_DOMINIO, entidadId: 0, accion: "reanudar", antes: { motivo: freno.motivo } });
  });
  return estadoFreno(db);
}

export async function estadoFreno(db: DrizzleDb) {
  const freno = await leerFreno(db);
  const cuenta = await contarEventos(db, freno);
  return {
    pausado: freno.pausado,
    motivo: freno.motivo,
    pausado_en: freno.pausado_en,
    quejas_7d: cuenta.quejas,
    rebotes_7d: cuenta.duros + cuenta.suaves,
    rebotes_duros_7d: cuenta.duros,
    rebotes_suaves_7d: cuenta.suaves,
    enviados_7d: cuenta.enviados,
    tasa_rebote_7d: tasaDeRebote(cuenta),
    limite_quejas: env.FRENO_QUEJAS_7D,
    limite_rebotes: env.FRENO_REBOTES_7D,
    limite_tasa: env.FRENO_TASA_REBOTE_7D,
    min_envios: env.FRENO_MIN_ENVIOS_7D
  };
}
