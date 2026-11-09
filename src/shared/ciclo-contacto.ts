import { and, desc, eq, inArray, ne, sql, type SQL } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { envios, listaSupresion, mediosContacto, prospectos, respuestas } from "../database/schema.js";

// Política de contactos (PLAN_N8N_DEFINITIVO.md): máximo tres contactos
// POR PERSONA (contacto) Y CAMPAÑA, no por prospecto -- la misma persona
// puede entrar varias veces al flujo de ingesta y cada entrada crea un
// prospecto nuevo. Tras MESES_ENFRIAMIENTO sin ningún contacto, la persona
// puede arrancar un ciclo nuevo (decisión de negocio, 23-sep-2026).
//
// Varias campañas (9-nov-2026): la empresa corre campañas de servicios
// distintos con los mismos contactos. Los 3 correos y los 6 meses de un "no
// interesado" se cuentan dentro de cada campaña, pero corre UNA serie a la
// vez (otraCampanaBloquea): la de B espera a que la de A termine. Un
// prospecto sin campaña (campana_id NULL) cuenta como un grupo más.
//
// Compartido por la automatización (AutomatizacionService) y por el botón
// "Mandar a automatización" del CRM (shared/listo-para-automatizacion.ts).
export const MAX_CONTACTOS_POR_CICLO = 3;
export const MESES_ENFRIAMIENTO = 6;

// Uno que PT1 tomó de la fila y que en este tiempo no avanzó (sigue
// en_fila: PT1 se cayó antes de Validaciones) se puede volver a tomar, y
// mientras tanto también sacar o cambiar de campaña.
export const HORAS_PARA_RETOMAR_DE_FILA = 24;

// Estados en los que un prospecto ya terminó: respondió y se clasificó, pidió
// la baja, o la automatización lo sacó del flujo. No recibe recordatorios
// (PT4) y la persona puede volver a entrar a prospección (salvo la baja).
export const ESTADOS_PROSPECTO_CERRADO: readonly string[] = ["baja", "interesado", "no_interesado", "descartado", "excluido", "inactivo"];

function sumarMeses(fecha: Date, meses: number): Date {
  const result = new Date(fecha);
  result.setMonth(result.getMonth() + meses);
  return result;
}

// prospectos.campana_id igual a la campaña dada, con NULL igual a NULL.
function mismaCampana(campanaId: number | null) {
  return sql`${prospectos.campanaId} <=> ${campanaId}`;
}

// Envíos del ciclo actual de la PERSONA en esta campaña y canal, sumando
// todos sus prospectos de la campaña, del más reciente al más antiguo. Antes
// se contaba por prospecto_id, así que un reingreso de la misma persona
// (prospecto nuevo, mismo contacto) arrancaba otra vez en 0 envíos y sin
// ventana abierta (hallazgo de la auditoría del workflow "PT1. ingesta y
// scoring", 22-sep-2026). El ciclo se corta en el primer hueco de
// MESES_ENFRIAMIENTO o más: si el último envío ya tiene esa antigüedad, el
// ciclo está vacío y la persona vuelve a empezar. Un envío fallido no
// cuenta: nunca llegó.
export async function cicloActualDePersona(db: DrizzleDb | DrizzleTx, contactoId: number, canal: "correo" | "whatsapp", campanaId: number | null) {
  const rows = await db
    .select({ id: envios.id, enviadoEn: envios.enviadoEn, ventanaEstado: envios.ventanaEstado, ventanaVenceEn: envios.ventanaVenceEn })
    .from(envios)
    .innerJoin(prospectos, eq(prospectos.id, envios.prospectoId))
    .where(and(eq(prospectos.contactoId, contactoId), mismaCampana(campanaId), eq(envios.canal, canal), ne(envios.estado, "fallido")))
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

// Quien contestó que no le interesa puede volver a entrar a prospección, pero
// no recibe correo hasta 6 meses después de su última respuesta de ese tipo
// (decisión de Carlos, 4-nov-2026). Sin esto, con menos de 3 correos en el
// ciclo le saldría otro en cuanto volviera a entrar. Si esa respuesta se
// corrigió, el prospecto ya no está en no_interesado y no hay espera. Solo
// cuenta el "no" a esta campaña: a otro servicio sí se le puede escribir
// (9-nov-2026).
export async function noInteresadoReciente(db: DrizzleDb | DrizzleTx, contactoId: number, campanaId: number | null) {
  const [ultima] = await db
    .select({ recibidoEn: respuestas.recibidoEn })
    .from(respuestas)
    .innerJoin(prospectos, eq(prospectos.id, respuestas.prospectoId))
    .where(and(eq(prospectos.contactoId, contactoId), mismaCampana(campanaId), eq(prospectos.estado, "no_interesado"), eq(respuestas.clasificacion, "no_interesado")))
    .orderBy(desc(respuestas.recibidoEn))
    .limit(1);
  return !!ultima && sumarMeses(ultima.recibidoEn, MESES_ENFRIAMIENTO) > new Date();
}

const ESTADOS_CERRADOS_SQL = sql.join(ESTADOS_PROSPECTO_CERRADO.map((e) => sql`${e}`), sql`, `);

/**
 * SQL: la persona `contacto` tiene un prospecto "interesado" en otra campaña
 * que `campana`. Lo atiende un vendedor: las demás campañas no le escriben
 * (9-nov-2026). `contacto` y `campana` pueden ser valores o columnas de la
 * consulta de afuera (tomarDeFila).
 */
export function interesadoEnOtraCampanaSql(contacto: SQL | number, campana: SQL | number | null) {
  return sql`EXISTS (SELECT 1 FROM prospectos pi WHERE pi.contacto_id = ${contacto} AND NOT (pi.campana_id <=> ${campana}) AND pi.estado = 'interesado')`;
}

/**
 * SQL: la persona tiene una serie en curso en otra campaña. Un prospecto de
 * otra campaña que no ha terminado (no cerrado) y que ya recibió un correo
 * en los últimos MESES_ENFRIAMIENTO, o que PT1 acaba de tomar de la fila y
 * va a recibirlo. Una serie termina cuando PT4 marca inactivo tras el
 * tercero o cuando la persona contesta: entonces arranca la siguiente.
 */
export function serieEnCursoEnOtraCampanaSql(contacto: SQL | number, campana: SQL | number | null) {
  return sql`EXISTS (SELECT 1 FROM prospectos ps WHERE ps.contacto_id = ${contacto} AND NOT (ps.campana_id <=> ${campana})
    AND ps.estado NOT IN (${ESTADOS_CERRADOS_SQL})
    AND (
      EXISTS (SELECT 1 FROM envios es WHERE es.prospecto_id = ps.id AND es.estado <> 'fallido' AND es.enviado_en > CURRENT_TIMESTAMP - INTERVAL ${sql.raw(String(MESES_ENFRIAMIENTO))} MONTH)
      OR (ps.estado = 'en_fila' AND ps.fila_tomado_en > CURRENT_TIMESTAMP - INTERVAL ${sql.raw(String(HORAS_PARA_RETOMAR_DE_FILA))} HOUR)
    ))`;
}

export type BloqueoDeOtraCampana = "interesado_en_otra_campana" | "serie_en_curso";

/**
 * Por qué otra campaña de la persona no deja que esta le escriba, o null.
 * El interesado frena todo (también los recordatorios); la serie en curso
 * solo frena el primer correo: quien llama decide cuál revisar.
 */
export async function otraCampanaBloquea(db: DrizzleDb | DrizzleTx, contactoId: number, campanaId: number | null): Promise<BloqueoDeOtraCampana | null> {
  const [filas] = await db.execute(sql`SELECT ${interesadoEnOtraCampanaSql(contactoId, campanaId)} AS interesado, ${serieEnCursoEnOtraCampanaSql(contactoId, campanaId)} AS serie`);
  const fila = (filas as unknown as { interesado: number | string; serie: number | string }[])[0];
  if (Number(fila?.interesado)) return "interesado_en_otra_campana";
  if (Number(fila?.serie)) return "serie_en_curso";
  return null;
}

export const MENSAJE_SERIE_EN_CURSO = "Otra campaña con esta persona sigue en curso";
export const MENSAJE_INTERESADO_EN_OTRA = "Le interesó otra campaña; lo atiende un vendedor";

// Bloquea los correos de la persona hasta que termine la transacción. Así dos
// envíos de la misma persona se forman, y una supresión al mismo tiempo espera
// a que este envío termine (o este a que ella termine). Va antes de leer con
// correoUtilizable, para que esa lectura vea lo último confirmado.
export async function bloquearCorreosDePersona(tx: DrizzleTx, contactoId: number) {
  await tx
    .select({ id: mediosContacto.id })
    .from(mediosContacto)
    .where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.tipo, "correo")))
    .orderBy(mediosContacto.id)
    .for("update");
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
