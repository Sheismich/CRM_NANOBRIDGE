import type { respuestas } from "../database/schema.js";

export type ClasificacionRespuesta = NonNullable<typeof respuestas.$inferSelect["clasificacion"]>;

/**
 * Estado en que queda el prospecto según cómo se clasificó su respuesta.
 * Lo comparten la clasificación de n8n (AutomatizacionService.
 * clasificarRespuesta) y la manual de la cola de clasificación
 * (TareasService.clasificar), para que las dos no diverjan. NULL = no se
 * toca el estado:
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
