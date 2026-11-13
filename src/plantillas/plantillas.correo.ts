import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { contactos, empresas, envios, parametrosAutomatizacion, plantillasCorreo, prospectos } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { armarCorreo, type CorreoArmado, type DatosPlantilla } from "../shared/plantillas.js";
import { urlDeBaja } from "../shared/link-baja.js";

export const CLAVE_PIE_CORREO = "pie_correo";

type Db = DrizzleDb | DrizzleTx;

export async function leerPie(db: Db): Promise<string> {
  const [fila] = await db.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_PIE_CORREO)).limit(1);
  return typeof fila?.valor === "string" ? fila.valor : "";
}

export async function datosDelProspecto(db: Db, prospectoId: number): Promise<DatosPlantilla & { giro: string | null; campanaId: number | null }> {
  const [fila] = await db
    .select({ nombre: contactos.nombre, nombreComercial: empresas.nombreComercial, nombreLegal: empresas.nombreLegal, giro: empresas.giro, campanaId: prospectos.campanaId })
    .from(prospectos)
    .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
    .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
    .where(eq(prospectos.id, prospectoId))
    .limit(1);
  if (!fila) throw new HttpError(404, "Prospecto no encontrado");
  return { nombre: fila.nombre, empresa: fila.nombreComercial || fila.nombreLegal, giro: fila.giro, campanaId: fila.campanaId };
}

// La de la campaña del prospecto si tiene una para ese número (9-nov-2026);
// si no, la del giro de la empresa; si no, la general. La comparación de giro
// es la de MySQL (sin distinguir mayúsculas ni acentos).
export async function elegirPlantilla(db: Db, campanaId: number | null, giro: string | null, numero: number) {
  const giros = giro?.trim() ? [giro.trim(), ""] : [""];
  const deLaCampana = and(eq(plantillasCorreo.campanaId, campanaId ?? 0), eq(plantillasCorreo.giro, ""));
  const generales = and(isNull(plantillasCorreo.campanaId), inArray(plantillasCorreo.giro, giros));
  const [plantilla] = await db
    .select()
    .from(plantillasCorreo)
    .where(and(eq(plantillasCorreo.numero, numero), campanaId != null ? or(deLaCampana, generales) : generales))
    .orderBy(sql`${plantillasCorreo.campanaId} IS NULL`, desc(plantillasCorreo.giro))
    .limit(1);
  // Las generales se siembran en la migración 033 y no se pueden borrar.
  if (!plantilla) throw new Error(`No hay plantilla general para el correo ${numero}`);
  return plantilla;
}

/** El correo del contacto número `numeroEnCiclo` (1-3) de este prospecto, y qué plantilla se usó. */
export async function correoParaEnvio(db: Db, prospectoId: number, numeroEnCiclo: number): Promise<{ plantillaId: number; correo: CorreoArmado }> {
  const datos = await datosDelProspecto(db, prospectoId);
  const plantilla = await elegirPlantilla(db, datos.campanaId, datos.giro, Math.min(Math.max(numeroEnCiclo, 1), 3));
  return { plantillaId: plantilla.id, correo: armarCorreo(plantilla, datos, await leerPie(db), { linkDeBaja: urlDeBaja(prospectoId) }) };
}

/**
 * El correo de un envío ya registrado (reintento de n8n con el mismo
 * execution_id): se vuelve a armar con la plantilla que se guardó. Los
 * envíos de antes de la 033 no tienen plantilla, y la de una campaña se pudo
 * quitar después: usan la que hoy toca a su campaña y número de contacto.
 */
export async function correoDeEnvio(db: Db, envioId: number): Promise<CorreoArmado> {
  const [envio] = await db.select({ prospectoId: envios.prospectoId, plantillaId: envios.plantillaId, numeroContacto: envios.numeroContacto }).from(envios).where(eq(envios.id, envioId)).limit(1);
  if (!envio) throw new HttpError(404, "Envío no encontrado");
  const datos = await datosDelProspecto(db, envio.prospectoId);
  const [guardada] = envio.plantillaId != null ? await db.select().from(plantillasCorreo).where(eq(plantillasCorreo.id, envio.plantillaId)).limit(1) : [];
  const plantilla = guardada ?? (await elegirPlantilla(db, datos.campanaId, null, Math.min(envio.numeroContacto, 3)));
  return armarCorreo(plantilla, datos, await leerPie(db), { linkDeBaja: urlDeBaja(envio.prospectoId) });
}
