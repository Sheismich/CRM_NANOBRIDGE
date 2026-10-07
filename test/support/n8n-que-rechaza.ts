import { env } from "../../src/config/env.js";

// Las pruebas de reintentos del outbox necesitan que cada entrega a n8n
// falle de forma determinista. Antes bastaba con N8N_WEBHOOK_URL="" (el
// despachador intentaba y tronaba), pero desde el 7-oct-2026 sin URL no se
// despacha nada (test/345-outbox-sin-destino.spec.ts). Esta URL local
// rechaza la conexión al instante: fetch truena con "fetch failed".
const URL_QUE_RECHAZA = "http://127.0.0.1:9/webhook-de-prueba";

export function usarN8nQueRechaza() {
  const antes = env.N8N_WEBHOOK_URL;
  env.N8N_WEBHOOK_URL = URL_QUE_RECHAZA;
  return () => {
    env.N8N_WEBHOOK_URL = antes;
  };
}
