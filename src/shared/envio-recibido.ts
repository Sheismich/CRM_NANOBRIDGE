import { and, eq } from "drizzle-orm";
import type { DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, envios, eventosSendgrid, prospectos } from "../database/schema.js";
import { ESTADOS_PROSPECTO_CERRADO, cicloActualDePersona } from "./ciclo-contacto.js";

// #4 de la revisión del 20-nov-2026: n8n puede reportar como fallido un correo
// que SendGrid sí recibió (contestó tarde y n8n se cansó de esperar). Antes la
// API lo reprogramaba y la persona lo recibía dos veces. Cualquier aviso del
// Event Webhook de ese envío (entregado, en espera, rebotado, descartado...)
// prueba que SendGrid lo recibió: ya no se vuelve a mandar.
//
// Orden de bloqueo, para que el aviso y el "fallido" de n8n no se traben: los
// dos bloquean primero la fila del envío. El aviso la bloquea ANTES de guardar
// el evento (sendgrid-eventos), así quien llegue segundo ve lo que hizo el otro.
export const ACCION_ENVIO_RECIBIDO = "envio_recibido_por_sendgrid";

/** SendGrid ya mandó algún aviso de este envío. Busca por prospecto (hay índice) y envío. */
export async function sendgridLoRecibio(tx: DrizzleTx, envio: { id: number; prospectoId: number }) {
  const [fila] = await tx
    .select({ evento: eventosSendgrid.evento })
    .from(eventosSendgrid)
    .where(and(eq(eventosSendgrid.prospectoId, envio.prospectoId), eq(eventosSendgrid.envioId, envio.id)))
    .limit(1)
    .for("share");
  return fila?.evento ?? null;
}

/**
 * El aviso llegó después de que n8n lo reportó fallido: el envío vuelve a
 * "enviado" y se deshace lo que hizo reprogramarEnvio (AutomatizacionService):
 * si había un envío anterior, se cierra otra vez su ventana (la había reabierto
 * para que PT4 mandara de nuevo); si era el primer correo, sale de la fila.
 * Si n8n ya lo volvió a registrar (reintento en la misma fila), es tarde: no
 * se toca. El llamador ya bloqueó la fila del envío.
 */
export async function corregirFallidoRecibido(tx: DrizzleTx, envioId: number, evento: string) {
  const [envio] = await tx.select({ estado: envios.estado, prospectoId: envios.prospectoId, canal: envios.canal }).from(envios).where(eq(envios.id, envioId)).limit(1);
  if (!envio || envio.estado !== "fallido") return false;
  const [prospecto] = await tx.select({ contactoId: prospectos.contactoId, campanaId: prospectos.campanaId, estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, envio.prospectoId)).limit(1);
  if (!prospecto) return false;

  // El ciclo no cuenta los fallidos: el primero es el envío anterior a este.
  const [anterior] = await cicloActualDePersona(tx, prospecto.contactoId, envio.canal, prospecto.campanaId);
  let deshizo: "ventana_reabierta" | "vuelta_a_fila" | null = null;
  if (anterior) {
    const [r] = await tx.update(envios).set({ ventanaEstado: "vencida" }).where(and(eq(envios.id, anterior.id), eq(envios.ventanaEstado, "abierta")));
    if (r.affectedRows > 0) deshizo = "ventana_reabierta";
  } else {
    const [r] = await tx.update(prospectos).set({ estado: "validado" }).where(and(eq(prospectos.id, envio.prospectoId), eq(prospectos.estado, "en_fila")));
    if (r.affectedRows > 0) deshizo = "vuelta_a_fila";
  }

  // Si mientras tanto el prospecto se cerró (contestó, baja...), su ventana no se abre.
  const cerrado = ESTADOS_PROSPECTO_CERRADO.includes(prospecto.estado);
  await tx.update(envios).set({ estado: "enviado", ventanaEstado: cerrado ? "cerrada" : "abierta" }).where(eq(envios.id, envioId));
  await anotar(tx, envioId, evento, deshizo, "fallido");
  return true;
}

/** "Fallido" de n8n con un aviso de SendGrid ya guardado: queda enviado y no se reprograma. */
export async function confirmarRecibido(tx: DrizzleTx, envioId: number, evento: string) {
  await tx.update(envios).set({ estado: "enviado" }).where(eq(envios.id, envioId));
  await anotar(tx, envioId, evento, null, "registrado");
}

async function anotar(tx: DrizzleTx, envioId: number, evento: string, deshizo: string | null, antes: "fallido" | "registrado") {
  await tx.insert(auditoria).values({
    usuarioId: null,
    entidad: "envio",
    entidadId: envioId,
    accion: ACCION_ENVIO_RECIBIDO,
    antes: { estado: antes },
    despues: { estado: "enviado", motivo: `n8n lo reportó fallido, pero SendGrid avisó "${evento}": sí lo recibió`.slice(0, 255), deshizo }
  });
}
