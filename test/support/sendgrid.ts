import { randomUUID, sign } from "node:crypto";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";

export const RUTA_WEBHOOK_SENDGRID = "/api/v1/webhooks/sendgrid/eventos";

// Firma un lote como lo hace SendGrid: ECDSA SHA-256 sobre timestamp + cuerpo.
export function firmarLote(cuerpo: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const firma = sign("sha256", Buffer.concat([Buffer.from(timestamp), Buffer.from(cuerpo)]), process.env.TEST_SENDGRID_PRIVATE_KEY!).toString("base64");
  return { firma, timestamp };
}

export function mandarLote(app: INestApplication, eventos: object[], opciones: { firma?: string } = {}) {
  const cuerpo = JSON.stringify(eventos);
  const firmado = firmarLote(cuerpo);
  return request(app.getHttpServer())
    .post(RUTA_WEBHOOK_SENDGRID)
    .set("Content-Type", "application/json")
    .set("X-Twilio-Email-Event-Webhook-Signature", opciones.firma ?? firmado.firma)
    .set("X-Twilio-Email-Event-Webhook-Timestamp", firmado.timestamp)
    .send(cuerpo);
}

type Evento = {
  event: string;
  email: string;
  type?: string;
  reason?: string;
  prospecto_id?: number;
  envio_id?: number;
  timestamp?: number;
  sg_event_id?: string;
};

// Un evento de SendGrid con lo mínimo; los custom_args van como texto.
export function evento(e: Evento) {
  return {
    sg_event_id: e.sg_event_id ?? randomUUID(),
    sg_message_id: `${randomUUID()}.filter`,
    timestamp: e.timestamp ?? Math.floor(Date.now() / 1000),
    event: e.event,
    email: e.email,
    ...(e.type ? { type: e.type } : {}),
    ...(e.reason ? { reason: e.reason, status: "5.0.0", bounce_classification: "Invalid Address" } : {}),
    ...(e.prospecto_id ? { prospecto_id: String(e.prospecto_id) } : {}),
    ...(e.envio_id ? { envio_id: String(e.envio_id) } : {})
  };
}
