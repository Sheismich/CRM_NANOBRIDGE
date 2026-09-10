import type { DrizzleTx } from "../database/drizzle.constants.js";
import { mediosContacto } from "../database/schema.js";

export type MedioContactoCandidato = {
  tipo: "correo" | "telefono" | "whatsapp";
  valor: string | undefined;
  valorNormalizado: string | null;
};

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
  for (const { tipo, valor, valorNormalizado } of candidatos) {
    if (valor && valorNormalizado) {
      await tx.insert(mediosContacto).values({ contactoId, tipo, valor, valorNormalizado, esPrincipal: tipo === "correo" });
    }
  }
}
