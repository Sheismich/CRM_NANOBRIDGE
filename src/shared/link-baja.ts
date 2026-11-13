import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";

// Link de baja del pie de los correos (13-nov-2026):
// CRM_URL/api/v1/baja/<prospecto_id>.<firma>. Lleva a una página nuestra con
// un botón (src/baja/); antes era el link de SendGrid, que daba de baja con
// solo abrirlo y los escáneres de links de Microsoft 365 lo abrían solos.
//
// La firma impide dar de baja a otra persona cambiando el número. Usa el
// mismo secreto que el Reply-To (src/shared/reply-to.ts) con otro prefijo,
// así una firma de Reply-To no sirve aquí ni al revés. Rotar el secreto
// invalida los links de los correos ya enviados.
const LARGO_FIRMA = 32;
const FORMATO = /^(\d{1,15})\.([0-9a-f]{32})$/;

export const RUTA_BAJA = "/api/v1/baja";

// Para la vista previa de Administración: se ve como el de verdad y no sirve.
export const URL_BAJA_EJEMPLO = `${env.CRM_URL}${RUTA_BAJA}/ejemplo`;

function firma(prospectoId: number) {
  return createHmac("sha256", env.REPLY_TO_SIGNING_SECRET).update(`baja:v1:${prospectoId}`).digest("hex").slice(0, LARGO_FIRMA);
}

export function urlDeBaja(prospectoId: number) {
  return `${env.CRM_URL}${RUTA_BAJA}/${prospectoId}.${firma(prospectoId)}`;
}

// El prospecto_id si el token es nuestro y la firma es válida; null si no.
export function leerTokenDeBaja(token: string): number | null {
  const match = FORMATO.exec(token);
  if (!match) return null;
  const prospectoId = Number(match[1]);
  return timingSafeEqual(Buffer.from(match[2]!), Buffer.from(firma(prospectoId))) ? prospectoId : null;
}
