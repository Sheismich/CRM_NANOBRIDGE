import { readFile } from "node:fs/promises";
import { ENV_FILE } from "./shared-env-path.js";

// setupFiles corre en el contexto de CADA archivo de prueba, antes de que
// ese archivo importe nada de src/ -- por eso este archivo puede fijar
// process.env a tiempo para que src/config/env.ts (que valida con Zod al
// importarse, una sola vez) lea los valores correctos la primera vez que
// alguna prueba haga `import { ... } from "../src/..."`.
const { DATABASE_URL } = JSON.parse(await readFile(ENV_FILE, "utf8")) as { DATABASE_URL: string };

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = DATABASE_URL;
// Los 3 secretos deben ser distintos entre sí (env.ts lo exige con
// superRefine) -- valores fijos de prueba, sin relación con ningún secreto
// real.
process.env.CRM_CALLBACK_API_KEY = "test_crm_callback_api_key_0001";
process.env.WEBHOOK_ENTRADA_API_KEY = "test_webhook_entrada_api_key_0002";
process.env.STORAGE_LOCAL_SIGNING_SECRET = "test_storage_signing_secret_0003";
process.env.N8N_WEBHOOK_URL = "";
process.env.CORS_ORIGINS = "";
// Fijados explícitamente (no solo los de arriba): dotenv/config, que
// src/config/env.ts carga después, NUNCA sobreescribe una variable que ya
// esté en process.env -- sin esto, cualquier valor real presente en el
// .env de quien corra `npm test` (ej. STORAGE_DRIVER=gcs con credenciales
// de un bucket real) se colaba tal cual a la app de pruebas en vez de usar
// un valor de prueba controlado (hallazgo de code-review, 15-sep-2026).
process.env.STORAGE_DRIVER = "local";
process.env.STORAGE_LOCAL_DIR = "./storage-test";
process.env.GCS_BUCKET = "";
process.env.GCS_PROJECT_ID = "";
process.env.GCS_KEY_FILE = "";
process.env.PORT = "3000";
process.env.SESSION_COOKIE_NAME = "nanobridge_session";
process.env.SESSION_TTL_HOURS = "12";
process.env.OUTBOX_DISPATCH_INTERVAL_MS = "15000";
process.env.STORAGE_MAX_FILE_SIZE_MB = "25";
process.env.STORAGE_SIGNED_URL_TTL_SECONDS = "300";
