import { and, eq, ne } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, prospectos } from "../database/schema.js";
import type { ClasificacionRespuesta } from "./clasificaciones.js";
import { darDeBajaPersona, personaEnBaja } from "./baja-prospecto.js";
import { HttpError } from "./http-error.js";
import { suprimirContactoPorBaja } from "./supresion.js";

export type { ClasificacionRespuesta };

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
 * "baja", lo da de baja (darDeBajaProspecto: también cancela sus
 * seguimientos) y suprime a su contacto. Corre dentro de la transacción de
 * quien llama.
 *
 * "La baja manda" (decisión de Fabián, 1-oct-2026): si el prospecto ya
 * está en baja -- p. ej. usó el link de SendGrid mientras su respuesta
 * esperaba en la cola --, ninguna otra clasificación lo saca de ahí. Antes
 * un "interesado" posterior lo regresaba a interesado. `enBaja` le dice a
 * quien llama que no cree tareas de seguimiento.
 */
export async function aplicarClasificacionAlProspecto(tx: DrizzleTx, prospectoId: number, clasificacion: ClasificacionRespuesta, origen: OrigenClasificacion) {
  const motivo = `Clasificada como ${clasificacion} (${origen.descripcion})`;
  const [antes] = await tx.select({ estado: prospectos.estado, contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
  if (!antes) throw new HttpError(404, "Prospecto no encontrado");

  if (clasificacion === "baja") {
    // La baja es de la persona: todos sus prospectos (A2, 2-oct-2026).
    await darDeBajaPersona(tx, antes.contactoId, { accion: ACCION_CAMBIO_ESTADO_POR_CLASIFICACION, motivo, executionId: origen.executionId, usuarioId: origen.usuarioId });
    const supresionIds = await suprimirContactoPorBaja(tx, prospectoId, { motivo: `Baja pedida en respuesta (${origen.descripcion})`, executionId: origen.executionId, usuarioId: origen.usuarioId });
    return { estadoProspecto: "baja", supresionIds, enBaja: true };
  }

  // "La baja manda" se mide por persona: si cualquiera de sus prospectos
  // está en baja, este no cambia de estado ni recibe tareas.
  if (antes.estado === "baja" || await personaEnBaja(tx, antes.contactoId)) {
    return { estadoProspecto: null, supresionIds: [] as number[], enBaja: true };
  }

  const estadoProspecto = ESTADO_PROSPECTO_POR_CLASIFICACION[clasificacion];
  if (estadoProspecto) {
    // Guarda dentro del UPDATE (A3, 2-oct-2026): si una baja se confirmó
    // entre la revisión de arriba y esta escritura, el UPDATE no la pisa y
    // la clasificación se trata como de alguien en baja.
    const [result] = await tx.update(prospectos).set({ estado: estadoProspecto }).where(and(eq(prospectos.id, prospectoId), ne(prospectos.estado, "baja")));
    if (result.affectedRows === 0) return { estadoProspecto: null, supresionIds: [] as number[], enBaja: true };
    await tx.insert(auditoria).values({
      usuarioId: origen.usuarioId,
      entidad: "prospecto",
      entidadId: prospectoId,
      accion: ACCION_CAMBIO_ESTADO_POR_CLASIFICACION,
      antes: { estado: antes?.estado ?? null },
      despues: { execution_id: origen.executionId, estado: estadoProspecto, motivo }
    });
  }
  return { estadoProspecto, supresionIds: [] as number[], enBaja: false };
}
