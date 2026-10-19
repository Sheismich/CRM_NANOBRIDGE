import { and, desc, eq, inArray } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { contactos, empresas, envios, parametrosAutomatizacion, plantillasCorreo, prospectos } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { armarCorreo, type CorreoArmado, type DatosPlantilla } from "../shared/plantillas.js";

export const CLAVE_PIE_CORREO = "pie_correo";

type Db = DrizzleDb | DrizzleTx;

export async function leerPie(db: Db): Promise<string> {
  const [fila] = await db.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_PIE_CORREO)).limit(1);
  return typeof fila?.valor === "string" ? fila.valor : "";
}

export async function datosDelProspecto(db: Db, prospectoId: number): Promise<DatosPlantilla & { giro: string | null }> {
  const [fila] = await db
    .select({ nombre: contactos.nombre, nombreComercial: empresas.nombreComercial, nombreLegal: empresas.nombreLegal, giro: empresas.giro })
    .from(prospectos)
    .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
    .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
    .where(eq(prospectos.id, prospectoId))
    .limit(1);
  if (!fila) throw new HttpError(404, "Prospecto no encontrado");
  return { nombre: fila.nombre, empresa: fila.nombreComercial || fila.nombreLegal, giro: fila.giro };
}

// La del giro de la empresa si existe; si no, la general de ese número. La
// comparación de giro es la de MySQL (sin distinguir mayúsculas ni acentos).
async function elegirPlantilla(db: Db, giro: string | null, numero: number) {
  const giros = giro?.trim() ? [giro.trim(), ""] : [""];
  const [plantilla] = await db
    .select()
    .from(plantillasCorreo)
    .where(and(eq(plantillasCorreo.numero, numero), inArray(plantillasCorreo.giro, giros)))
    .orderBy(desc(plantillasCorreo.giro))
    .limit(1);
  // Las generales se siembran en la migración 033 y no se pueden borrar.
  if (!plantilla) throw new Error(`No hay plantilla general para el correo ${numero}`);
  return plantilla;
}

/** El correo del contacto número `numeroEnCiclo` (1-3) de este prospecto, y qué plantilla se usó. */
export async function correoParaEnvio(db: Db, prospectoId: number, numeroEnCiclo: number): Promise<{ plantillaId: number; correo: CorreoArmado }> {
  const datos = await datosDelProspecto(db, prospectoId);
  const plantilla = await elegirPlantilla(db, datos.giro, Math.min(Math.max(numeroEnCiclo, 1), 3));
  return { plantillaId: plantilla.id, correo: armarCorreo(plantilla, datos, await leerPie(db)) };
}

/**
 * El correo de un envío ya registrado (reintento de n8n con el mismo
 * execution_id): se vuelve a armar con la plantilla que se guardó. Los
 * envíos de antes de la 033 no tienen plantilla: usan la general de su
 * número de contacto.
 */
export async function correoDeEnvio(db: Db, envioId: number): Promise<CorreoArmado> {
  const [envio] = await db.select({ prospectoId: envios.prospectoId, plantillaId: envios.plantillaId, numeroContacto: envios.numeroContacto }).from(envios).where(eq(envios.id, envioId)).limit(1);
  if (!envio) throw new HttpError(404, "Envío no encontrado");
  const datos = await datosDelProspecto(db, envio.prospectoId);
  const [guardada] = envio.plantillaId != null ? await db.select().from(plantillasCorreo).where(eq(plantillasCorreo.id, envio.plantillaId)).limit(1) : [];
  const plantilla = guardada ?? (await elegirPlantilla(db, null, Math.min(envio.numeroContacto, 3)));
  return armarCorreo(plantilla, datos, await leerPie(db));
}
