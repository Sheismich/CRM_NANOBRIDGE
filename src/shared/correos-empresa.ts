import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleDb } from "../database/drizzle.constants.js";
import { contactos, listaSupresion, mediosContacto } from "../database/schema.js";
import { personaEnBaja } from "./baja-prospecto.js";

// Los correos de los contactos activos de una empresa, uno por renglón (un
// contacto puede tener varios), con el "por qué no" de cada uno: la persona
// pidió la baja, o el correo está en no contactar o en la lista de supresión.
// Lo usan "Responder por correo" (Para y copia, 18-nov-2026) y la cotización
// por correo (esa se queda con uno por contacto).
export type CorreoDeEmpresa = {
  medio_id: number;
  contacto_id: number;
  nombre: string;
  puesto: string | null;
  correo: string;
  correo_normalizado: string;
  motivo: string | null;
};

export const MOTIVO_PERSONA_EN_BAJA = "Pidió la baja: no se le puede escribir.";
export const MOTIVO_CORREO_NO_CONTACTAR = "El correo está en no contactar.";

// Por contacto, el activo primero; así el primero de cada contacto es el que
// se usaría si solo se quiere uno.
export async function correosDeLaEmpresa(db: DrizzleDb, empresaId: number): Promise<CorreoDeEmpresa[]> {
  const filas = await db
    .select({
      medioId: mediosContacto.id,
      contactoId: contactos.id,
      nombre: contactos.nombre,
      puesto: contactos.puesto,
      correo: mediosContacto.valor,
      valorNormalizado: mediosContacto.valorNormalizado,
      estado: mediosContacto.estadoContacto
    })
    .from(contactos)
    .innerJoin(mediosContacto, and(eq(mediosContacto.contactoId, contactos.id), eq(mediosContacto.tipo, "correo")))
    .where(and(eq(contactos.empresaId, empresaId), eq(contactos.activo, true)))
    .orderBy(asc(contactos.id), sql`${mediosContacto.estadoContacto} = 'activo' DESC`, asc(mediosContacto.id));
  if (filas.length === 0) return [];

  const suprimidos = new Set(
    (await db.select({ valor: listaSupresion.valorNormalizado }).from(listaSupresion)
      .where(and(eq(listaSupresion.tipo, "correo"), inArray(listaSupresion.valorNormalizado, filas.map((f) => f.valorNormalizado))))).map((s) => s.valor)
  );
  const enBaja = new Map<number, boolean>();
  for (const id of new Set(filas.map((f) => f.contactoId))) enBaja.set(id, await personaEnBaja(db, id));

  return filas.map((f) => {
    let motivo: string | null = null;
    if (enBaja.get(f.contactoId)) motivo = MOTIVO_PERSONA_EN_BAJA;
    else if (f.estado !== "activo" || suprimidos.has(f.valorNormalizado)) motivo = MOTIVO_CORREO_NO_CONTACTAR;
    return { medio_id: f.medioId, contacto_id: f.contactoId, nombre: f.nombre, puesto: f.puesto, correo: f.correo, correo_normalizado: f.valorNormalizado, motivo };
  });
}
