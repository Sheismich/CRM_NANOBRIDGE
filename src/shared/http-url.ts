import { z } from "zod";

// URL que el CRM guarda y el frontend luego pinta como enlace (sitio web,
// redes sociales, fuente del prospecto). Solo http/https: z.string().url()
// a secas acepta cualquier esquema, incluidos `javascript:alert(1)` y
// `data:text/html,...`, y un valor así guardado se volvía XSS almacenado en
// cuanto una pantalla lo usara como href. Se comprobó en vivo el 18-sep-2026
// que la validación anterior lo dejaba pasar.
// El mensaje va en español porque llega tal cual a la pantalla (ej. la
// revisión fila por fila de una importación CSV).
export const httpUrlSchema = z
  .string()
  .trim()
  .url({ protocol: /^https?$/, error: "URL no válida; debe empezar con http:// o https://" })
  .max(2048, "Máximo 2048 caracteres");
