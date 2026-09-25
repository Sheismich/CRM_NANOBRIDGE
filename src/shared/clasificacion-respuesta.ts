import { eq } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, prospectos, type respuestas } from "../database/schema.js";
import { suprimirContactoPorBaja } from "./supresion.js";

export type ClasificacionRespuesta = NonNullable<typeof respuestas.$inferSelect["clasificacion"]>;

// Acción de auditoría que deja un cambio de estado hecho por una
// clasificación; ActividadesService la lee para el Historial de la ficha
// de cliente, junto con "cambiar_estado_automatizacion".
export const ACCION_CAMBIO_ESTADO_POR_CLASIFICACION = "cambiar_estado_por_clasificacion";

/**
 * Estado en que queda el prospecto según cómo se clasificó su respuesta.
 * NULL = no se toca el estado:
 * - automatica: un "fuera de oficina" no dice nada del prospecto.
 * - reagendar: la decisión queda en la tarea de seguimiento que se crea.
 */
export const ESTADO_PROSPECTO_POR_CLASIFICACION: Record<ClasificacionRespuesta, string | null> = {
  interesado: "interesado",
  no_interesado: "no_interesado",
  baja: "baja",
  automatica: null,
  ambigua: "en_revision",
  invalido: "descartado",
  reagendar: null
};

export type OrigenClasificacion = {
  // Quién o qué clasificó, en texto: "clasificación manual, tarea 12",
  // "clasificación de n8n, respuesta 5". Va en el motivo del cambio de
  // estado y de la supresión.
  descripcion: string;
  // execution_id de n8n; NULL cuando clasifica una persona.
  executionId: string | null;
  // Quien clasificó; NULL = automatización.
  usuarioId: number | null;
};

/**
 * Lo que una clasificación le hace al prospecto, igual venga de n8n
 * (AutomatizacionService.clasificarRespuesta) o de la cola manual
 * (TareasService.clasificar): fija su estado, deja el cambio en auditoría
 * (para que aparezca en el Historial de la ficha de cliente) y, si es
 * "baja", suprime a su contacto. Corre dentro de la transacción de quien
 * llama.
 */
export async function aplicarClasificacionAlProspecto(tx: DrizzleTx, prospectoId: number, clasificacion: ClasificacionRespuesta, origen: OrigenClasificacion) {
  const estadoProspecto = ESTADO_PROSPECTO_POR_CLASIFICACION[clasificacion];
  if (estadoProspecto) {
    const [antes] = await tx.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
    await tx.update(prospectos).set({ estado: estadoProspecto }).where(eq(prospectos.id, prospectoId));
    await tx.insert(auditoria).values({
      usuarioId: origen.usuarioId,
      entidad: "prospecto",
      entidadId: prospectoId,
      accion: ACCION_CAMBIO_ESTADO_POR_CLASIFICACION,
      antes: { estado: antes?.estado ?? null },
      despues: { execution_id: origen.executionId, estado: estadoProspecto, motivo: `Clasificada como ${clasificacion} (${origen.descripcion})` }
    });
  }

  const supresionIds = clasificacion === "baja"
    ? await suprimirContactoPorBaja(tx, prospectoId, { motivo: `Baja pedida en respuesta (${origen.descripcion})`, executionId: origen.executionId, usuarioId: origen.usuarioId })
    : [];
  return { estadoProspecto, supresionIds };
}
