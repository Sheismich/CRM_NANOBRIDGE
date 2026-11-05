import { and, count, eq, gte, inArray, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, listaSupresion, parametrosAutomatizacion } from "../database/schema.js";
import { env } from "../config/env.js";
import { HttpError } from "./http-error.js";
import { adminsYSupervisores, notificar } from "../notificaciones/notificar.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// Freno automático del dominio: una lista mala quema un dominio nuevo, y a 20
// correos al día los porcentajes engañan, así que cuenta quejas y rebotes de
// los últimos 7 días. Solo frena la prospección: las respuestas de vendedores
// y las cotizaciones las manda una persona, a alguien que ya está en
// conversación. Se reanuda a mano; después solo cuenta lo que llegue de nuevo.
const CLAVE_FRENO_DOMINIO = "freno_dominio";
const EVENTO_QUEJA = "spamreport";
const EVENTO_REBOTE = "bounce";

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

// bloquear: lectura con bloqueo (FOR SHARE), que ve lo último confirmado y no
// la "foto" de la transacción (REPEATABLE READ). Lo usa evaluarFreno.
async function contarEventos(db: DrizzleDb | DrizzleTx, freno: Freno, bloquear = false) {
  // reanudado_en es ISO en UTC, igual que la sesión de MySQL.
  const desdeReanudar = freno.reanudado_en ? freno.reanudado_en.slice(0, 19).replace("T", " ") : null;
  const consulta = db
    .select({ evento: listaSupresion.evento, n: count() })
    .from(listaSupresion)
    .where(and(
      inArray(listaSupresion.evento, [EVENTO_QUEJA, EVENTO_REBOTE]),
      gte(listaSupresion.creadoEn, sql`CURRENT_TIMESTAMP - INTERVAL 7 DAY`),
      desdeReanudar ? gte(listaSupresion.creadoEn, sql`${desdeReanudar}`) : undefined
    ))
    .groupBy(listaSupresion.evento);
  const filas = await (bloquear ? consulta.for("share") : consulta);
  const de = (evento: string) => Number(filas.find((f) => f.evento === evento)?.n ?? 0);
  return { quejas: de(EVENTO_QUEJA), rebotes: de(EVENTO_REBOTE) };
}

async function guardar(tx: DrizzleTx, valor: Freno) {
  await tx
    .insert(parametrosAutomatizacion)
    .values({ clave: CLAVE_FRENO_DOMINIO, valor, descripcion: "Freno automatico del dominio; se reanuda en Administracion" })
    .onDuplicateKeyUpdate({ set: { valor } });
}

// Corre dentro de la transacción que registró la supresión. El bloqueo forma a
// dos eventos simultáneos: el segundo cuenta después de que el primero termine,
// así no se quedan cortos los dos ni avisan dos veces.
// Forma a los eventos que cuentan para el freno. Quien guarda una queja o un
// rebote lo pide ANTES de guardarla (AutomatizacionService.registrarSupresion).
export async function bloquearFreno(tx: DrizzleTx) {
  const [fila] = await tx.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_FRENO_DOMINIO)).for("update");
  return aFreno(fila?.valor);
}

// Las dos lecturas son con bloqueo: si la transacción ya había leído algo
// antes de esperar el FOR UPDATE, una lectura normal seguiría viendo su foto
// de entonces, sin la queja que el otro evento acaba de confirmar.
export async function evaluarFreno(tx: DrizzleTx) {
  const freno = await bloquearFreno(tx);
  if (freno.pausado) return;

  const { quejas, rebotes } = await contarEventos(tx, freno, true);
  const motivo = quejas >= env.FRENO_QUEJAS_7D
    ? `Llegaron ${quejas} quejas de spam en 7 días.`
    : rebotes >= env.FRENO_REBOTES_7D ? `Llegaron ${rebotes} rebotes en 7 días.` : null;
  if (!motivo) return;

  await guardar(tx, { ...freno, pausado: true, motivo, pausado_en: new Date().toISOString() });
  await tx.insert(auditoria).values({ usuarioId: null, entidad: CLAVE_FRENO_DOMINIO, entidadId: 0, accion: "pausar", despues: { motivo, quejas, rebotes } });
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
  const { quejas, rebotes } = await contarEventos(db, freno);
  return {
    pausado: freno.pausado,
    motivo: freno.motivo,
    pausado_en: freno.pausado_en,
    quejas_7d: quejas,
    rebotes_7d: rebotes,
    limite_quejas: env.FRENO_QUEJAS_7D,
    limite_rebotes: env.FRENO_REBOTES_7D
  };
}
