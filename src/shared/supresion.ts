import { and, eq } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, listaSupresion, mediosContacto } from "../database/schema.js";
import { isDuplicateEntry } from "./database-errors.js";
import { normalizeEmail, normalizePhone } from "./normalize.js";

export type TipoMedioSupresion = "correo" | "telefono" | "whatsapp";

export function normalizarValorSupresion(tipo: TipoMedioSupresion, valor: string): string {
  return tipo === "correo" ? normalizeEmail(valor) : normalizePhone(valor);
}

export type SupresionNueva = {
  tipo: TipoMedioSupresion;
  valor: string;
  motivo: string;
  // execution_id de n8n; NULL cuando la origina una persona desde el CRM.
  executionId: string | null;
  // Quien la originó, para auditoría; NULL = automatización.
  usuarioId: number | null;
};

/**
 * Registro de supresión (PLAN_API_DEFINITIVO.md): deja el medio en
 * lista_supresion (la fuente de verdad que consultan los gates de envío) y,
 * si ese medio ya existe en medios_contacto, lo marca 'no_contactar'. La
 * baja aplica al medio de contacto específico, no a toda la empresa
 * (PLAN_CRM_DEFINITIVO.md).
 *
 * Recibe la transacción de quien llama en vez de abrir la suya (antes vivía
 * en AutomatizacionService y abría su propia transacción): así una
 * clasificación "baja" -- manual desde el CRM o de n8n -- registra la
 * supresión en la MISMA transacción que el resto de su decisión, y un
 * fallo posterior la revierte junto con todo lo demás (24-sep-2026).
 *
 * Idempotente por (tipo, valor_normalizado): si el medio ya estaba
 * suprimido devuelve ya_existia sin tocar nada más. El ER_DUP_ENTRY se
 * atrapa aquí dentro: en InnoDB un error de llave duplicada solo revierte
 * esa sentencia, no la transacción, así que quien llama puede seguir
 * usándola. El SELECT posterior es de bloqueo (FOR SHARE) para ver la fila
 * ya confirmada por la otra transacción aunque la nuestra tenga un snapshot
 * más viejo (REPEATABLE READ).
 */
export async function registrarSupresion(tx: DrizzleTx, input: SupresionNueva) {
  const valorNormalizado = normalizarValorSupresion(input.tipo, input.valor);

  let insertId: number;
  try {
    const [result] = await tx.insert(listaSupresion).values({
      tipo: input.tipo,
      valorNormalizado,
      motivo: input.motivo,
      executionId: input.executionId
    });
    insertId = result.insertId;
  } catch (error) {
    if (isDuplicateEntry(error)) {
      const [existing] = await tx
        .select({ id: listaSupresion.id })
        .from(listaSupresion)
        .where(and(eq(listaSupresion.tipo, input.tipo), eq(listaSupresion.valorNormalizado, valorNormalizado)))
        .limit(1)
        .for("share");
      if (existing) return { id: existing.id, ya_existia: true as const };
    }
    throw error;
  }

  await tx.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(and(eq(mediosContacto.tipo, input.tipo), eq(mediosContacto.valorNormalizado, valorNormalizado)));

  await tx.insert(auditoria).values({
    usuarioId: input.usuarioId,
    entidad: "medio_contacto",
    entidadId: insertId,
    accion: "registrar_supresion",
    despues: { execution_id: input.executionId, tipo: input.tipo, motivo: input.motivo }
  });

  return { id: insertId, ya_existia: false as const };
}
