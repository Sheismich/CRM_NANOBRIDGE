import { Injectable } from "@nestjs/common";
import { env } from "../config/env.js";
import type { CorreoSaliente, CorreoService } from "./correo.types.js";

const URL_SENDGRID = "https://api.sendgrid.com/v3/mail/send";
const TIEMPO_MAXIMO_MS = 8000;

// SendGrid v3 mail/send con fetch (sin SDK). Sin rastreo de clics ni de
// aperturas ni link de baja: son correos internos o respuestas uno a uno, no
// campañas. La llave solo necesita el permiso Mail Send.
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
    content: [
      { type: "text/plain", value: correo.texto },
      { type: "text/html", value: correo.html }
    ],
    categories: [correo.categoria],
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false }
    }
  };
}
