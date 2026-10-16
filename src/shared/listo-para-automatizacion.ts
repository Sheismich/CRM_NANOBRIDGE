import { and, eq, ne } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { contactos, empresas, prospectos } from "../database/schema.js";
import { personaEnBaja } from "./baja-prospecto.js";
import { MAX_CONTACTOS_POR_CICLO, cicloActualDePersona, correoUtilizable } from "./ciclo-contacto.js";

// Uno que PT1 tomó de la fila y que en este tiempo no avanzó (sigue
// en_fila: PT1 se cayó antes de Validaciones) se puede volver a tomar, y
// mientras tanto también sacar o cambiar de campaña.
export const HORAS_PARA_RETOMAR_DE_FILA = 24;

export function tomadoDeFilaHace(filaTomadoEn: Date | null, ahora = new Date()) {
  return filaTomadoEn !== null && ahora.getTime() - filaTomadoEn.getTime() < HORAS_PARA_RETOMAR_DE_FILA * 3_600_000;
}

// Por qué el botón "Mandar a automatización" no deja entrar a un prospecto a
// la fila. Claves fijas: el CRM pone el texto.
export type MotivoNoListo =
  | "giro_no_informado"
  | "tamano_no_informado"
  | "sin_correo"
  | "suprimido"
  | "en_baja"
  | "contacto_desactivado"
  | "maximo_contactos"
  | "ventana_activa"
  | "ya_en_fila";

/**
 * ¿Le saldría el correo inicial a este prospecto si PT1 lo tomara hoy? Junta
 * en un solo lugar lo que PT1 revisa por partes (Validaciones: giro y
 * tamaño; Verificación de envío: contacto activo, supresión, máximo de 3 y
 * ventana de espera) para que el botón lo diga en el momento, en vez de que
 * PT1 lo marque "excluido" días después por un dato que se corrige
 * (decisión de Fabián, 16-oct-2026). Solo correo: WhatsApp sigue apagado.
 *
 * No reemplaza a PT1: lo que cambie mientras espera en la fila (una baja, un
 * rebote) lo vuelven a revisar Validaciones y verificarEnvio justo antes de
 * mandar.
 */
export async function revisarListoParaAutomatizacion(db: DrizzleDb | DrizzleTx, prospectoId: number): Promise<MotivoNoListo[]> {
  const [row] = await db
    .select({ contactoId: prospectos.contactoId, giro: empresas.giro, tamano: empresas.tamano, contactoActivo: contactos.activo, empresaActiva: empresas.activo })
    .from(prospectos)
    .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
    .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
    .where(eq(prospectos.id, prospectoId))
    .limit(1);
  if (!row) throw new Error(`revisarListoParaAutomatizacion: prospecto ${prospectoId} no existe`);

  const motivos: MotivoNoListo[] = [];
  if (!row.contactoActivo || !row.empresaActiva) motivos.push("contacto_desactivado");
  if (!row.giro) motivos.push("giro_no_informado");
  if (!row.tamano) motivos.push("tamano_no_informado");
  if (await personaEnBaja(db, row.contactoId)) motivos.push("en_baja");

  const correo = await correoUtilizable(db, row.contactoId);
  if ("motivo" in correo) motivos.push(correo.motivo);

  const ciclo = await cicloActualDePersona(db, row.contactoId, "correo");
  const ultimo = ciclo[0];
  if (ciclo.length >= MAX_CONTACTOS_POR_CICLO) motivos.push("maximo_contactos");
  else if (ultimo && ultimo.ventanaEstado === "abierta" && ultimo.ventanaVenceEn > new Date()) motivos.push("ventana_activa");

  // Otro prospecto de la misma persona esperando en la fila: le saldrían dos
  // correos iniciales.
  const [otro] = await db
    .select({ id: prospectos.id })
    .from(prospectos)
    .where(and(eq(prospectos.contactoId, row.contactoId), eq(prospectos.estado, "en_fila"), ne(prospectos.id, prospectoId)))
    .limit(1);
  if (otro) motivos.push("ya_en_fila");

  return motivos;
}
