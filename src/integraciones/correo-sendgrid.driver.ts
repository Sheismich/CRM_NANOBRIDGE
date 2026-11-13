import { Injectable } from "@nestjs/common";
import { env } from "../config/env.js";
import type { CorreoSaliente, CorreoService } from "./correo.types.js";

const URL_SENDGRID = "https://api.sendgrid.com/v3/mail/send";
const TIEMPO_MAXIMO_MS = 8000;

// SendGrid v3 mail/send con fetch (sin SDK). Sin rastreo de clics ni de
// aperturas, y sin el link de baja de SendGrid (13-nov-2026): daba de baja
// con solo abrirlo y los escáneres de Microsoft 365 lo abrían. El link de
// baja ya viene dentro del correo y es nuestro (shared/link-baja.ts). La
// llave solo necesita el permiso Mail Send.
@Injectable()
export class CorreoSendgridDriver implements CorreoService {
  async enviar(correo: CorreoSaliente) {
    const respuesta = await fetch(URL_SENDGRID, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(cuerpoSendgrid(correo)),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS)
    });
    if (!respuesta.ok) {
      const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
      throw new Error(`SendGrid respondió ${respuesta.status}: ${detalle}`);
    }
    return { id: respuesta.headers.get("x-message-id") };
  }
}

export function cuerpoSendgrid(correo: CorreoSaliente) {
  return {
    personalizations: [{ to: [{ email: correo.para, ...(correo.nombrePara ? { name: correo.nombrePara } : {}) }] }],
    from: { email: env.CORREO_REMITENTE, name: correo.nombreRemitente ?? env.CORREO_REMITENTE_NOMBRE },
    ...(correo.replyTo ? { reply_to: { email: correo.replyTo } } : {}),
    subject: correo.asunto,
    // Content-Language: Gmail ofrecía traducir del inglés (3-nov-2026).
    headers: { "Content-Language": "es", ...correo.cabeceras },
    content: [
      { type: "text/plain", value: correo.texto },
      { type: "text/html", value: correo.html }
    ],
    ...(correo.adjuntos?.length
      ? { attachments: correo.adjuntos.map((a) => ({ filename: a.nombre, type: a.tipo, content: a.contenidoBase64, disposition: "attachment" })) }
      : {}),
    categories: [correo.categoria],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false }
    }
  };
}
