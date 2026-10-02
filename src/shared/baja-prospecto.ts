import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
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

  // FOR UPDATE: lectura con bloqueo, que ve lo último confirmado. Con una
  // lectura normal (la "foto" de REPEATABLE READ) se escapaba una tarea de
  // vendedor creada por una clasificación justo mientras esta baja esperaba
  // el bloqueo del prospecto, y esa tarea se quedaba abierta (A3, 2-oct-2026).
  const abiertas = await tx
    .select({ id: tareas.id })
    .from(tareas)
    .where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.tipo, "seguimiento"), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`))
    .for("update");
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

/**
 * La baja es de la PERSONA (contacto), no de un prospecto suyo: pone en
 * baja a todos sus prospectos y cancela sus seguimientos. La usan los dos
 * caminos de baja -- respuesta clasificada "baja" (manual o n8n) y link de
 * baja / queja de spam de SendGrid -- para que no vuelvan a separarse
 * (A2 del plan de fixes, 2-oct-2026: antes la respuesta solo tocaba ese
 * prospecto y un reingreso de la misma persona seguía "interesado" con su
 * tarea de vendedor abierta). Devuelve los prospectos que sí cambiaron.
 */
export async function darDeBajaPersona(tx: DrizzleTx, contactoId: number, origen: OrigenBaja) {
  const suyos = await tx.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.contactoId, contactoId)).orderBy(prospectos.id);
  const prospectosEnBaja: number[] = [];
  const tareasCanceladas: number[] = [];
  for (const prospecto of suyos) {
    const resultado = await darDeBajaProspecto(tx, prospecto.id, origen);
    if (resultado.cambio) prospectosEnBaja.push(prospecto.id);
    tareasCanceladas.push(...resultado.tareasCanceladas);
  }
  return { prospectosEnBaja, tareasCanceladas };
}

// Code del 409 al crear a mano un seguimiento a una persona dada de baja.
export const CODIGO_PERSONA_EN_BAJA = "PERSONA_EN_BAJA";

/**
 * ¿Esta persona pidió la baja? Sí, si cualquiera de sus prospectos está en
 * baja. Un rebote NO cuenta (suprime un correo, pero no es una petición de
 * la persona), por eso no se mira lista_supresion aquí.
 */
export async function personaEnBaja(tx: DrizzleDb | DrizzleTx, contactoId: number) {
  const [fila] = await tx.select({ id: prospectos.id }).from(prospectos).where(and(eq(prospectos.contactoId, contactoId), eq(prospectos.estado, "baja"))).limit(1);
  return !!fila;
}
