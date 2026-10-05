import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { contactos, empresas, mediosContacto } from "../database/schema.js";

export type IdentidadPersona =
  | { tipo: "misma_persona"; contactoId: number; empresaId: number; motivo: "correo" | "telefono" }
  // Persona nueva. empresaDelTelefono: la empresa de quien ya tiene ese
  // teléfono (típicamente el conmutador): la persona nueva va ahí.
  // telefonoOcupado: el número ya es de otro contacto, así que no se le
  // vuelve a guardar a esta persona (UNIQUE global de medios_contacto).
  | { tipo: "nueva"; empresaDelTelefono: number | null; telefonoOcupado: boolean };

/**
 * ¿Quién es esta persona? Regla única para n8n (registrarProspecto) y el CRM
 * (alta manual e importación CSV), decisión de Fabián del 2-oct-2026: "el
 * correo manda".
 *
 * - Con correo, solo el correo identifica. Mismo teléfono con otro correo es
 *   otra persona (dos personas que comparten el conmutador de su empresa).
 *   Antes se tomaba "correo O teléfono, el primero que coincida", y la
 *   segunda persona quedaba fundida con la primera: su correo ni se
 *   guardaba, y los recordatorios, el límite de 3 contactos y las bajas se
 *   aplicaban a la persona equivocada (hallazgo del /code-review del
 *   2-oct-2026).
 * - Sin correo, identifica el teléfono, guardado como telefono o como
 *   whatsapp (antes solo se buscaba como telefono).
 *
 * No toca medios de empresa (contacto_id NULL): esos no son personas.
 *
 * Contactos y empresas desactivados SÍ cuentan como la misma persona:
 * desactivar no borra sus medios (el UNIQUE global los sigue apartando) y
 * verificarEnvio ya no les manda nada. Lo que no se hace es meter a una
 * persona NUEVA en la empresa desactivada de quien tiene su teléfono: ahí
 * nadie la vería (code review de verificación, 5-oct-2026).
 */
export async function buscarPersona(db: DrizzleDb | DrizzleTx, datos: { correoNormalizado: string | null; telefonoNormalizado: string | null }): Promise<IdentidadPersona> {
  const [porTelefono] = datos.telefonoNormalizado
    ? await db
      .select({ contactoId: contactos.id, empresaId: contactos.empresaId, empresaActiva: empresas.activo })
      .from(mediosContacto)
      .innerJoin(contactos, eq(contactos.id, mediosContacto.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(and(inArray(mediosContacto.tipo, ["telefono", "whatsapp"]), eq(mediosContacto.valorNormalizado, datos.telefonoNormalizado)))
      .orderBy(mediosContacto.id)
      .limit(1)
    : [];

  if (datos.correoNormalizado) {
    const [porCorreo] = await db
      .select({ contactoId: contactos.id, empresaId: contactos.empresaId })
      .from(mediosContacto)
      .innerJoin(contactos, eq(contactos.id, mediosContacto.contactoId))
      .where(and(eq(mediosContacto.tipo, "correo"), eq(mediosContacto.valorNormalizado, datos.correoNormalizado)))
      .limit(1);
    if (porCorreo) return { tipo: "misma_persona", contactoId: porCorreo.contactoId, empresaId: porCorreo.empresaId, motivo: "correo" };
    return { tipo: "nueva", empresaDelTelefono: porTelefono?.empresaActiva ? porTelefono.empresaId : null, telefonoOcupado: !!porTelefono };
  }

  if (porTelefono) return { tipo: "misma_persona", contactoId: porTelefono.contactoId, empresaId: porTelefono.empresaId, motivo: "telefono" };
  return { tipo: "nueva", empresaDelTelefono: null, telefonoOcupado: false };
}
