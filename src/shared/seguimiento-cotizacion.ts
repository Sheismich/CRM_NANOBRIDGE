import { and, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { cotizaciones, tareas } from "../database/schema.js";

const RESULTADO_CANCELADO = "Cancelada: la cotización ya no sigue abierta";

// Una tarea "Dar seguimiento a cotización" deja de tener caso cuando la
// cotización se acepta, se rechaza, vence, se reemplaza o su oportunidad cierra.
export async function cancelarSeguimiento(tx: DrizzleTx, cotizacionId: number) {
  await tx.update(tareas).set({ estado: "cancelada", resultado: RESULTADO_CANCELADO, cerradaEn: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(tareas.cotizacionId, cotizacionId), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
}

export async function cancelarSeguimientosDeOportunidad(tx: DrizzleTx, oportunidadId: number) {
  const filas = await tx.select({ id: cotizaciones.id }).from(cotizaciones).where(eq(cotizaciones.oportunidadId, oportunidadId));
  if (filas.length === 0) return;
  await tx.update(tareas).set({ estado: "cancelada", resultado: RESULTADO_CANCELADO, cerradaEn: sql`CURRENT_TIMESTAMP` })
    .where(and(inArray(tareas.cotizacionId, filas.map((f) => f.id)), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
}
