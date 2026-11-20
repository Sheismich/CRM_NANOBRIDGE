import { createPublicKey, verify, type KeyObject } from "node:crypto";

// Signed Event Webhook de SendGrid: firma ECDSA (SHA-256) sobre el timestamp
// seguido del cuerpo crudo. La firma llega en base64 (DER) en
// X-Twilio-Email-Event-Webhook-Signature y el timestamp en
// X-Twilio-Email-Event-Webhook-Timestamp. La llave pública que muestra
// SendGrid es base64 de una llave SPKI en DER.
export const ENCABEZADO_FIRMA = "x-twilio-email-event-webhook-signature";
export const ENCABEZADO_TIMESTAMP = "x-twilio-email-event-webhook-timestamp";

const llaves = new Map<string, KeyObject>();

function llavePublica(base64: string): KeyObject {
  let llave = llaves.get(base64);
  if (!llave) {
    llave = createPublicKey({ key: Buffer.from(base64, "base64"), format: "der", type: "spki" });
    llaves.set(base64, llave);
  }
  return llave;
}

export function firmaSendgridValida(llaveBase64: string, cuerpo: Buffer, firma: string | undefined, timestamp: string | undefined): boolean {
  if (!firma || !timestamp) return false;
  try {
    const firmado = Buffer.concat([Buffer.from(timestamp, "utf8"), cuerpo]);
    return verify("sha256", firmado, llavePublica(llaveBase64), Buffer.from(firma, "base64"));
  } catch {
    // Llave o firma con forma inválida: igual que una firma que no cuadra.
    return false;
  }
}
