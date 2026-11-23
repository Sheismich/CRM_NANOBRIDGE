import { and, count, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { envios, parametrosAutomatizacion } from "../database/schema.js";
import { adminsYSupervisores, notificar } from "../notificaciones/notificar.js";
import { esDiaHabilMx, fechaMx } from "./dia-habil.js";

// Aviso de "n8n no corrió" (#2 de la revisión del 20-nov-2026). Antes, si n8n
// se paraba, nadie se enteraba: la tarjeta de Administración solo se ve si
// alguien entra. Cada vez que PT4 pide los recordatorios o PT1a toma de la
// fila, la API anota la hora (el latido). A las 11:00 de cada día hábil un
// Cloud Scheduler de Google llama a /jobs/revisar-n8n. No lo llama n8n: si
// n8n se cae, PT5 también. Si alguno de los dos no llamó hoy, o hay correos
// atorados, avisa a administradores y supervisores, con correo que manda la
// API. Una vez al día.

const FLUJOS = ["pt4", "pt1a"] as const;
export type FlujoN8n = (typeof FLUJOS)[number];

const CLAVE_LATIDO: Record<FlujoN8n, string> = { pt4: "latido_n8n_pt4", pt1a: "latido_n8n_pt1a" };
const NOMBRE_FLUJO: Record<FlujoN8n, string> = { pt4: "PT4 (recordatorios)", pt1a: "PT1a (nuevos de la fila)" };
const CLAVE_AVISO = "aviso_n8n";

// Un envío que n8n registró y no confirmó en este tiempo se quedó atorado: n8n
// se cayó entre registrarlo y mandarlo (o antes de confirmar).
const HORAS_SIN_CONFIRMAR = 1;

// Llega aunque no haya nada que mandar, sea feriado o haya pausa: lo que se
// anota es que n8n corrió.
export async function anotarLlamadaN8n(db: DrizzleDb | DrizzleTx, flujo: FlujoN8n) {
  const valor = { en: new Date().toISOString() };
  await db
    .insert(parametrosAutomatizacion)
    .values({ clave: CLAVE_LATIDO[flujo], valor, descripcion: `Ultima llamada de n8n ${flujo.toUpperCase()}; la revisa el aviso de n8n sin correr` })
    .onDuplicateKeyUpdate({ set: { valor } });
}

// Registrados hace más de HORAS_SIN_CONFIRMAR sin confirmar. destinatario
// NULL = fila de antes de la 039: nadie la va a confirmar. La hora va como
// texto UTC: mysql2 formatea un Date de JS con la zona de la máquina.
export async function contarEnviosSinConfirmar(db: DrizzleDb | DrizzleTx, ahora = new Date()) {
  const limite = new Date(ahora.getTime() - HORAS_SIN_CONFIRMAR * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
  const [fila] = await db
    .select({ n: count() })
    .from(envios)
    .where(and(eq(envios.estado, "registrado"), isNotNull(envios.destinatario), lt(envios.enviadoEn, sql`${limite}`)));
  return Number(fila?.n ?? 0);
}

export async function revisarN8n(db: DrizzleDb, ahora = new Date()) {
  const fecha = fechaMx(ahora);
  if (!esDiaHabilMx(fecha)) return { fecha, dia_habil: false, faltan: [] as FlujoN8n[], envios_sin_confirmar: 0, avisado: false };

  const latidos = await db
    .select({ clave: parametrosAutomatizacion.clave, valor: parametrosAutomatizacion.valor })
    .from(parametrosAutomatizacion)
    .where(inArray(parametrosAutomatizacion.clave, Object.values(CLAVE_LATIDO)));
  const ultimaLlamada = new Map(latidos.map((l) => [l.clave, (l.valor as { en?: string } | null)?.en ?? null]));
  const faltan = FLUJOS.filter((flujo) => {
    const en = ultimaLlamada.get(CLAVE_LATIDO[flujo]);
    return !en || fechaMx(new Date(en)) !== fecha;
  });
  const sinConfirmar = await contarEnviosSinConfirmar(db, ahora);
  const resultado = { fecha, dia_habil: true, faltan, envios_sin_confirmar: sinConfirmar };
  if (faltan.length === 0 && sinConfirmar === 0) return { ...resultado, avisado: false };

  const avisado = await db.transaction(async (tx) => {
    // Una vez al día: la fila del último aviso se bloquea, así dos corridas a
    // la vez (un reintento del Scheduler) no avisan dos veces.
    await tx.insert(parametrosAutomatizacion).ignore().values({ clave: CLAVE_AVISO, valor: {}, descripcion: "Dia del ultimo aviso de n8n sin correr" });
    const [fila] = await tx.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_AVISO)).for("update");
    if ((fila?.valor as { fecha?: string } | null)?.fecha === fecha) return false;
    await tx.update(parametrosAutomatizacion).set({ valor: { fecha } }).where(eq(parametrosAutomatizacion.clave, CLAVE_AVISO));
    await notificar(tx, await adminsYSupervisores(tx), {
      tipo: "n8n_sin_correr",
      titulo: faltan.length > 0 ? "La automatización no corrió hoy" : "Hay correos atorados en la automatización",
      cuerpo: textoDelAviso(faltan, sinConfirmar),
      enlace: "/administracion",
      entidad: "n8n",
      conCorreo: true
    });
    return true;
  });
  return { ...resultado, avisado };
}

function textoDelAviso(faltan: readonly FlujoN8n[], sinConfirmar: number) {
  const partes: string[] = [];
  if (faltan.length > 0) {
    partes.push(`No llegó a la API: ${faltan.map((f) => NOMBRE_FLUJO[f]).join(" ni ")}. Revisa en n8n que el flujo esté activo y sus últimas ejecuciones.`);
  }
  if (sinConfirmar > 0) {
    partes.push(sinConfirmar === 1
      ? "1 correo se registró hace más de una hora y n8n no confirmó si salió: se pudo caer a la mitad del envío."
      : `${sinConfirmar} correos se registraron hace más de una hora y n8n no confirmó si salieron: se pudo caer a la mitad del envío.`);
  }
  return partes.join(" ");
}
