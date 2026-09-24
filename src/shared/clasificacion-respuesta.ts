import { eq } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { prospectos, type respuestas } from "../database/schema.js";
import { suprimirContactoPorBaja, type OrigenSupresion } from "./supresion.js";

export type ClasificacionRespuesta = NonNullable<typeof respuestas.$inferSelect["clasificacion"]>;

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

/**
 * Lo que una clasificación le hace al prospecto, igual venga de n8n
 * (AutomatizacionService.clasificarRespuesta) o de la cola manual
 * (TareasService.clasificar): fija su estado y, si es "baja", suprime a su
 * contacto. Corre dentro de la transacción de quien llama.
 */
export async function aplicarClasificacionAlProspecto(tx: DrizzleTx, prospectoId: number, clasificacion: ClasificacionRespuesta, origen: OrigenSupresion) {
  const estadoProspecto = ESTADO_PROSPECTO_POR_CLASIFICACION[clasificacion];
  if (estadoProspecto) {
    await tx.update(prospectos).set({ estado: estadoProspecto }).where(eq(prospectos.id, prospectoId));
  }
  const supresionIds = clasificacion === "baja" ? await suprimirContactoPorBaja(tx, prospectoId, origen) : [];
  return { estadoProspecto, supresionIds };
}
