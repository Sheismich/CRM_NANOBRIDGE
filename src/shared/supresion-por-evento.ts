import { and, eq, isNotNull } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { mediosContacto } from "../database/schema.js";
import { darDeBajaPersona } from "./baja-prospecto.js";
import { suprimirMediosDeContacto, type OrigenSupresion, type TipoMedioSupresion } from "./supresion.js";

/**
 * Baja de la PERSONA por un evento de SendGrid (link de baja o queja de
 * spam): llega por correo, no por prospecto. Suprime todos los medios de
 * quien tenga ese valor y pasa todos sus prospectos a baja (que además
 * cancela sus seguimientos). Es la regla del 1-oct-2026, la misma que una
 * respuesta clasificada "baja".
 *
 * La usan POST /automatizacion/supresion (PT3) y el Event Webhook directo
 * (sendgrid-eventos), en la transacción de quien llama.
 */
export async function darDeBajaPorEvento(tx: DrizzleTx, tipo: TipoMedioSupresion, valorNormalizado: string, origen: OrigenSupresion) {
  const duenos = await tx
    .selectDistinct({ contactoId: mediosContacto.contactoId })
    .from(mediosContacto)
    .where(and(eq(mediosContacto.tipo, tipo), eq(mediosContacto.valorNormalizado, valorNormalizado), isNotNull(mediosContacto.contactoId)))
    .orderBy(mediosContacto.contactoId);

  const supresionIds = new Set<number>();
  const prospectosEnBaja: number[] = [];
  for (const { contactoId } of duenos) {
    for (const id of await suprimirMediosDeContacto(tx, contactoId!, origen)) supresionIds.add(id);

    // Misma acción que POST /prospectos/estado: el Historial de la
    // ficha de cliente la muestra como cambio de estado.
    const baja = await darDeBajaPersona(tx, contactoId!, { accion: "cambiar_estado_automatizacion", motivo: origen.motivo, executionId: origen.executionId, usuarioId: null });
    prospectosEnBaja.push(...baja.prospectosEnBaja);
  }
  return { supresionIds: [...supresionIds], prospectosEnBaja };
}
