import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, prospectos, tareas } from "../database/schema.js";

export const RESULTADO_TAREA_CANCELADA_POR_BAJA = "Cancelada: el prospecto pidió la baja";

export type OrigenBaja = {
  // Acción de auditoría del cambio de estado: una de las dos que lee el
  // Historial de la ficha (ActividadesService): "cambiar_estado_por_
  // clasificacion" o "cambiar_estado_automatizacion".
  accion: string;
  motivo: string;
  // execution_id de n8n; NULL cuando la origina una persona.
  executionId: string | null;
  // Quien la originó; NULL = automatización.
  usuarioId: number | null;
};

/**
 * Pone un prospecto en "baja" y cancela sus tareas de seguimiento abiertas,
 * en la transacción de quien llama. Es lo mismo venga de una respuesta
 * clasificada "baja" (manual o n8n) o del link de baja / queja de spam de
 * SendGrid (hallazgo del /code-review del 1-oct-2026: la baja dejaba
 * abiertas "Contactar prospecto interesado" y similares, y un vendedor
 * podía contactar a quien pidió que no).
 *
 * - El UPDATE solo cambia si el prospecto no estaba ya en baja, y la fila
 *   de auditoría solo se escribe si cambió: dos bajas simultáneas (p. ej.
 *   unsubscribe + spamreport) dejaban dos filas. InnoDB revalida el WHERE
 *   del UPDATE contra la última versión confirmada, así que la segunda ve
 *   affectedRows = 0.
 * - Se cancelan solo las tareas tipo "seguimiento". Las de la cola de
 *   clasificación se quedan para que alguien lea lo que contestó la persona
 *   (decisión de Fabián, 1-oct-2026); clasificarlas ya no la saca de baja
 *   (ver aplicarClasificacionAlProspecto).
 */
export async function darDeBajaProspecto(tx: DrizzleTx, prospectoId: number, origen: OrigenBaja) {
  const [antes] = await tx.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
  const [result] = await tx.update(prospectos).set({ estado: "baja" }).where(and(eq(prospectos.id, prospectoId), ne(prospectos.estado, "baja")));
  const cambio = result.affectedRows > 0;
  if (cambio) {
    await tx.insert(auditoria).values({
      usuarioId: origen.usuarioId,
      entidad: "prospecto",
      entidadId: prospectoId,
      accion: origen.accion,
      antes: { estado: antes?.estado ?? null },
      despues: { execution_id: origen.executionId, estado: "baja", motivo: origen.motivo }
    });
  }

  const abiertas = await tx
    .select({ id: tareas.id })
    .from(tareas)
    .where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.tipo, "seguimiento"), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
  const tareasCanceladas = abiertas.map((t) => t.id);
  if (tareasCanceladas.length > 0) {
    await tx.update(tareas).set({
      estado: "cancelada",
      resultado: RESULTADO_TAREA_CANCELADA_POR_BAJA,
      cerradaEn: sql`CURRENT_TIMESTAMP`
    }).where(and(inArray(tareas.id, tareasCanceladas), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
  }

  return { cambio, tareasCanceladas };
}
