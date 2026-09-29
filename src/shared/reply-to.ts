import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

// Reply-To firmado de cada correo (ronda 3 de SendGrid, PLAN_N8N_DEFINITIVO.md,
// 29-sep-2026): r+<envio_id>.<firma>@REPLY_TO_DOMAIN. La respuesta llega por
// Inbound Parse a esa dirección y n8n se la pasa tal cual a POST /respuestas;
// la firma impide que alguien que adivine el formato le atribuya un correo a
// otro prospecto. La firma son los primeros 16 caracteres hex (64 bits) de un
// HMAC-SHA256: la parte antes de la @ admite máximo 64 caracteres. Todo en
// minúsculas, porque algunos servidores de correo cambian mayúsculas.
const LARGO_FIRMA = 16;
const FORMATO = /^r\+(\d{1,15})\.([0-9a-f]{16})@(.+)$/;

function firma(envioId: number) {
  return createHmac("sha256", env.REPLY_TO_SIGNING_SECRET).update(`reply-to:v1:${envioId}`).digest("hex").slice(0, LARGO_FIRMA);
}

export function firmarReplyTo(envioId: number) {
  return `r+${envioId}.${firma(envioId)}@${env.REPLY_TO_DOMAIN}`;
}

// Devuelve el envio_id si la dirección es un Reply-To nuestro con firma
// válida; null en cualquier otro caso (otro dominio, sin firma, alterada).
export function leerReplyTo(direccion: string): number | null {
  const match = FORMATO.exec(direccion.trim().toLowerCase());
  if (!match || match[3] !== env.REPLY_TO_DOMAIN) return null;

  const envioId = Number(match[1]);
  const recibida = Buffer.from(match[2]!);
  const esperada = Buffer.from(firma(envioId));
  return timingSafeEqual(recibida, esperada) ? envioId : null;
}
