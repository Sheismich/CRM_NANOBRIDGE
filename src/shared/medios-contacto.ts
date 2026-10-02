import type { DrizzleTx } from "../database/drizzle.constants.js";
import { and, eq, inArray } from "drizzle-orm";
import { listaSupresion, mediosContacto } from "../database/schema.js";
import { personaEnBaja } from "./baja-prospecto.js";
import { normalizeEmail, normalizePhone } from "./normalize.js";

export type MedioContactoCandidato = {
  tipo: "correo" | "telefono" | "whatsapp";
  valor: string | undefined;
  valorNormalizado: string | null;
};

/**
 * Arma el arreglo de candidatos de medios de contacto a partir de un input
 * con correo/telefono/whatsapp opcionales, listo para insertarMediosContacto.
 * Antes este mismo arreglo de 3 líneas se re-tecleaba en
 * EmpresasService.create() y .addContact() -- mismo riesgo de divergencia
 * que ya describe el comentario de insertarMediosContacto (hallazgo de
 * code review, 14-sep-2026).
 */
export function buildMedioCandidatos(input: { correo?: string; telefono?: string; whatsapp?: string }): MedioContactoCandidato[] {
  return [
    { tipo: "correo", valor: input.correo, valorNormalizado: input.correo ? normalizeEmail(input.correo) : null },
    { tipo: "telefono", valor: input.telefono, valorNormalizado: input.telefono ? normalizePhone(input.telefono) : null },
    { tipo: "whatsapp", valor: input.whatsapp, valorNormalizado: input.whatsapp ? normalizePhone(input.whatsapp) : null }
  ];
}

/**
 * Inserta los medios de contacto no vacíos de un contacto. Antes esta
 * misma lógica estaba copiada en automatizacion.service.ts (registro de
 * prospecto) y en crm/empresas.service.ts (alta manual), con riesgo real
 * de que divergieran silenciosamente (hallazgo de code review,
 * 10-sep-2026) -- p. ej. un tipo de medio nuevo agregado en un lado y
 * olvidado en el otro.
 *
 * No maneja el UNIQUE(tipo, valor_normalizado) global: cada llamador
 * decide qué hacer ante un duplicado (automatizacion.service.ts reutiliza
 * el contacto existente antes de llegar aquí; empresas.service.ts deja que
 * el ER_DUP_ENTRY suba para convertirlo en un 409 explícito).
 */
export async function insertarMediosContacto(tx: DrizzleTx, contactoId: number, candidatos: MedioContactoCandidato[]) {
  // Devuelve los tipos que nacieron bloqueados (no_contactar), para que
  // quien llama lo pueda avisar (p. ej. la confirmación de un CSV).
  const suprimidos: MedioContactoCandidato["tipo"][] = [];
  for (const { tipo, valor, valorNormalizado } of candidatos) {
    if (valor && valorNormalizado) {
      const estadoContacto = await estadoInicialDeMedio(tx, contactoId, tipo, valorNormalizado);
      await tx.insert(mediosContacto).values({ contactoId, tipo, valor, valorNormalizado, esPrincipal: tipo === "correo", estadoContacto });
      if (estadoContacto === "no_contactar") suprimidos.push(tipo);
    }
  }
  return suprimidos;
}

// `code` del 409 al intentar cambiar o borrar un medio en no_contactar.
export const CODIGO_MEDIO_SUPRIMIDO = "MEDIO_SUPRIMIDO";

/**
 * Con qué estado nace (o queda, al editarlo) un medio de contacto: si el
 * valor está en lista_supresion, o la persona ya pidió la baja, nace en
 * no_contactar (A4 del plan de fixes, 2-oct-2026). Antes todo nacía activo:
 * el CRM nunca leía lista_supresion, y a alguien dado de baja se le podía
 * agregar un teléfono nuevo y contactarlo por ahí.
 *
 * Un teléfono se busca como telefono y como whatsapp: es el mismo número.
 * La usan todas las altas de medios (n8n, CRM, CSV) a través de
 * insertarMediosContacto, y la edición de un contacto.
 */
export async function estadoInicialDeMedio(tx: DrizzleTx, contactoId: number, tipo: MedioContactoCandidato["tipo"], valorNormalizado: string): Promise<"activo" | "no_contactar"> {
  const tipos: MedioContactoCandidato["tipo"][] = tipo === "correo" ? ["correo"] : ["telefono", "whatsapp"];
  const [suprimido] = await tx
    .select({ id: listaSupresion.id })
    .from(listaSupresion)
    .where(and(inArray(listaSupresion.tipo, tipos), eq(listaSupresion.valorNormalizado, valorNormalizado)))
    .limit(1);
  if (suprimido) return "no_contactar";
  return (await personaEnBaja(tx, contactoId)) ? "no_contactar" : "activo";
}
