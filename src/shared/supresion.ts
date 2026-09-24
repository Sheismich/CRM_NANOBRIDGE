import { and, eq, inArray } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, incidencias, listaSupresion, mediosContacto, prospectos } from "../database/schema.js";
import { isDuplicateEntry } from "./database-errors.js";
import { normalizeEmail, normalizePhone } from "./normalize.js";

export type TipoMedioSupresion = typeof listaSupresion.$inferInsert["tipo"];

export function normalizarValorSupresion(tipo: TipoMedioSupresion, valor: string): string {
  return tipo === "correo" ? normalizeEmail(valor) : normalizePhone(valor);
}

export type SupresionNueva = {
  tipo: TipoMedioSupresion;
  // Ya normalizado (normalizarValorSupresion, o el valor_normalizado
  // guardado en medios_contacto): así se compara exactamente contra lo que
  // leen los gates de envío, sin volver a normalizar algo ya normalizado.
  valorNormalizado: string;
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
 * suprimido devuelve ya_existia sin nueva fila ni auditoría, pero igual
 * marca el medio 'no_contactar' -- pudo darse de alta DESPUÉS de la
 * supresión y haber nacido 'activo' (hallazgo de /code-review,
 * 24-sep-2026). El ER_DUP_ENTRY se atrapa aquí dentro: en InnoDB un error
 * de llave duplicada solo revierte esa sentencia, no la transacción, así
 * que quien llama puede seguir usándola. El SELECT posterior es de bloqueo
 * (FOR SHARE) para ver la fila ya confirmada por la otra transacción
 * aunque la nuestra tenga un snapshot más viejo (REPEATABLE READ).
 */
export async function registrarSupresion(tx: DrizzleTx, input: SupresionNueva) {
  const { tipo, valorNormalizado } = input;

  let id: number;
  let yaExistia = false;
  try {
    const [result] = await tx.insert(listaSupresion).values({
      tipo,
      valorNormalizado,
      motivo: input.motivo,
      executionId: input.executionId
    });
    id = result.insertId;
  } catch (error) {
    if (!isDuplicateEntry(error)) throw error;
    const [existing] = await tx
      .select({ id: listaSupresion.id })
      .from(listaSupresion)
      .where(and(eq(listaSupresion.tipo, tipo), eq(listaSupresion.valorNormalizado, valorNormalizado)))
      .limit(1)
      .for("share");
    if (!existing) throw error;
    id = existing.id;
    yaExistia = true;
  }

  await tx.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(and(eq(mediosContacto.tipo, tipo), eq(mediosContacto.valorNormalizado, valorNormalizado)));
  if (yaExistia) return { id, ya_existia: true as const };

  await tx.insert(auditoria).values({
    usuarioId: input.usuarioId,
    entidad: "medio_contacto",
    entidadId: id,
    accion: "registrar_supresion",
    despues: { execution_id: input.executionId, tipo, motivo: input.motivo }
  });

  return { id, ya_existia: false as const };
}

// De dónde viene una supresión: viaja igual para una sola supresión o para
// la baja completa de un contacto.
export type OrigenSupresion = Pick<SupresionNueva, "motivo" | "executionId" | "usuarioId">;

const TIPOS_SUPRIMIBLES: TipoMedioSupresion[] = ["correo", "telefono", "whatsapp"];

/**
 * Una respuesta clasificada "baja" (por n8n o a mano): suprime TODOS los
 * medios contactables (correo, teléfono, WhatsApp) del contacto del
 * prospecto, no solo los del canal por el que respondió -- la persona pidió
 * no ser contactada, no dejar un canal (regla del 24-sep-2026). Sigue
 * siendo por contacto y por medio: no toca a otros contactos de la misma
 * empresa ni los medios de la empresa.
 *
 * Si el contacto no tiene ningún medio que suprimir, la clasificación NO se
 * rechaza (la persona ya pidió la baja), pero queda una incidencia 'alta':
 * si después se da de alta un correo o teléfono suyo, nada lo bloquearía, así
 * que alguien tiene que registrarlo a mano.
 *
 * ORDER BY id: dos bajas simultáneas del mismo contacto bloquean las filas
 * en el mismo orden y no pueden cruzarse en un deadlock.
 */
export async function suprimirContactoPorBaja(tx: DrizzleTx, prospectoId: number, origen: OrigenSupresion) {
  const medios = await tx
    .select({ tipo: mediosContacto.tipo, valorNormalizado: mediosContacto.valorNormalizado })
    .from(mediosContacto)
    .innerJoin(prospectos, eq(prospectos.contactoId, mediosContacto.contactoId))
    .where(and(eq(prospectos.id, prospectoId), inArray(mediosContacto.tipo, TIPOS_SUPRIMIBLES)))
    .orderBy(mediosContacto.id);

  if (medios.length === 0) {
    await tx.insert(incidencias).values({
      executionId: origen.executionId,
      prospectoId,
      tipo: "baja_sin_medios",
      severidad: "alta",
      mensaje: "El prospecto pidió la baja pero su contacto no tiene correo, teléfono ni WhatsApp que suprimir: registrarlos a mano en lista_supresion si aparecen.",
      detalle: { motivo: origen.motivo, usuario_id: origen.usuarioId }
    });
    return [];
  }

  const ids: number[] = [];
  for (const medio of medios) {
    const supresion = await registrarSupresion(tx, { tipo: medio.tipo as TipoMedioSupresion, valorNormalizado: medio.valorNormalizado, ...origen });
    ids.push(supresion.id);
  }
  return ids;
}
