import { z } from "zod";

// Un id que puede venir como número o como texto (los custom_args de
// SendGrid siempre son texto; el resto puede venir como número).
const idOpcional = z.preprocess(
  (v) => (typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v),
  z.number().int().positive().optional().catch(undefined)
);
const textoOpcional = z.preprocess((v) => (v == null ? undefined : String(v)), z.string().optional());

// Un evento del Event Webhook de SendGrid. Solo se leen los campos que se
// usan; los demás se ignoran. prospecto_id y envio_id son los custom_args
// que manda PT1 al enviar (llegan como llaves sueltas del evento).
export const eventoSendgridSchema = z.object({
  sg_event_id: z.string().trim().min(1).max(255),
  event: z.string().trim().min(1).max(40),
  email: textoOpcional,
  timestamp: z.coerce.number().int().positive(),
  type: textoOpcional,
  reason: textoOpcional,
  status: textoOpcional,
  bounce_classification: textoOpcional,
  prospecto_id: idOpcional,
  envio_id: idOpcional
});
export type EventoSendgrid = z.infer<typeof eventoSendgridSchema>;

// El lote completo. Un evento que no se entiende no tumba el lote (SendGrid
// reintentaría todo durante 24 h por uno malo): se cuenta como descartado.
export const loteSendgridSchema = z.array(z.unknown()).max(5000);
