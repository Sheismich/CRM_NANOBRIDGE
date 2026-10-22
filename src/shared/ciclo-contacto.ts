import { and, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { envios, listaSupresion, mediosContacto, prospectos } from "../database/schema.js";

// Política de contactos (PLAN_N8N_DEFINITIVO.md): máximo tres contactos
// totales POR PERSONA (contacto), no por prospecto -- la misma persona
// puede entrar varias veces al flujo de ingesta y cada entrada crea un
// prospecto nuevo. Tras MESES_ENFRIAMIENTO sin ningún contacto, la persona
// puede arrancar un ciclo nuevo (decisión de negocio, 23-sep-2026).
// Compartido por la automatización (AutomatizacionService) y por el botón
// "Mandar a automatización" del CRM (shared/listo-para-automatizacion.ts).
export const MAX_CONTACTOS_POR_CICLO = 3;
export const MESES_ENFRIAMIENTO = 6;

// Estados en los que un prospecto ya terminó: respondió y se clasificó, pidió
// la baja, o la automatización lo sacó del flujo. No recibe recordatorios
// (PT4) y la persona puede volver a entrar a prospección (salvo la baja).
export const ESTADOS_PROSPECTO_CERRADO: readonly string[] = ["baja", "interesado", "no_interesado", "descartado", "excluido", "inactivo"];

function sumarMeses(fecha: Date, meses: number): Date {
  const result = new Date(fecha);
  result.setMonth(result.getMonth() + meses);
  return result;
}

// Envíos del ciclo actual de la PERSONA en este canal, sumando todos sus
// prospectos, del más reciente al más antiguo. Antes se contaba por
// prospecto_id, así que un reingreso de la misma persona (prospecto nuevo,
// mismo contacto) arrancaba otra vez en 0 envíos y sin ventana abierta
// (hallazgo de la auditoría del workflow "PT1. ingesta y scoring",
// 22-sep-2026). El ciclo se corta en el primer hueco de MESES_ENFRIAMIENTO
// o más: si el último envío ya tiene esa antigüedad, el ciclo está vacío y
// la persona vuelve a empezar.
export async function cicloActualDePersona(db: DrizzleDb | DrizzleTx, contactoId: number, canal: "correo" | "whatsapp") {
  const rows = await db
    .select({ id: envios.id, enviadoEn: envios.enviadoEn, ventanaEstado: envios.ventanaEstado, ventanaVenceEn: envios.ventanaVenceEn })
    .from(envios)
    .innerJoin(prospectos, eq(prospectos.id, envios.prospectoId))
    .where(and(eq(prospectos.contactoId, contactoId), eq(envios.canal, canal)))
    .orderBy(desc(envios.enviadoEn), desc(envios.id));

  const ciclo: typeof rows = [];
  let referencia = new Date();
  for (const row of rows) {
    if (sumarMeses(row.enviadoEn, MESES_ENFRIAMIENTO) <= referencia) break;
    ciclo.push(row);
    referencia = row.enviadoEn;
  }
  return ciclo;
}

export type CorreoUtilizable = { valor: string } | { motivo: "sin_correo" | "suprimido" };

// El correo al que se manda: uno activo y fuera de lista_supresion (el
// principal primero). "sin_correo" si la persona no tiene ninguno
// utilizable; "suprimido" si los que tiene están dados de baja.
export async function correoUtilizable(db: DrizzleDb | DrizzleTx, contactoId: number): Promise<CorreoUtilizable> {
  const medios = await db
    .select({ valor: mediosContacto.valor, valorNormalizado: mediosContacto.valorNormalizado, estado: mediosContacto.estadoContacto })
    .from(mediosContacto)
    .where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.tipo, "correo"), inArray(mediosContacto.estadoContacto, ["activo", "no_contactar"])))
    .orderBy(desc(mediosContacto.esPrincipal), mediosContacto.id);
  if (medios.length === 0) return { motivo: "sin_correo" };

  const suprimidos = await db
    .select({ valorNormalizado: listaSupresion.valorNormalizado })
    .from(listaSupresion)
    .where(and(eq(listaSupresion.tipo, "correo"), inArray(listaSupresion.valorNormalizado, medios.map((m) => m.valorNormalizado))));
  const enSupresion = new Set(suprimidos.map((s) => s.valorNormalizado));

  const utilizable = medios.find((m) => m.estado === "activo" && !enSupresion.has(m.valorNormalizado));
  return utilizable ? { valor: utilizable.valor } : { motivo: "suprimido" };
}
