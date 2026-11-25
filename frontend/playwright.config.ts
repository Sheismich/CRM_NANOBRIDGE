import { generateKeyPairSync } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";

// Pruebas de navegador del camino principal (#15 de la revisión del 20-nov-2026):
// entrar, abrir una ficha y mandar un prospecto a automatización, con la API y la
// base de verdad (nada simulado salvo los correos y la IA, como en las pruebas de
// la API).
//
// Necesita un MySQL 8 corriendo. La base de E2E_DATABASE_URL se BORRA y se recrea en
// cada corrida (solo acepta nombres con "e2e" o "test"). Por omisión, el MySQL
// desechable de las pruebas de la API (README, «Pruebas automatizadas»).
//
//   cd frontend && npx playwright test
const BASE_DE_DATOS = process.env.E2E_DATABASE_URL ?? "mysql://root@127.0.0.1:3399/nanobridge_e2e";
const PUERTO_API = 3101;
const PUERTO_FRONT = 5174;
export const LLAVE_N8N = "e2e_crm_callback_api_key_0001";

const llaveSendgrid = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "der", type: "spki" }).toString("base64");

// Las mismas variables que usan las pruebas de la API (test/setup/setup-env.ts).
const envApi: Record<string, string> = {
  NODE_ENV: "development",
  DATABASE_URL: BASE_DE_DATOS,
  CRM_CALLBACK_API_KEY: LLAVE_N8N,
  REPLY_TO_SIGNING_SECRET: "e2e_reply_to_signing_secret_0000000001",
  REPLY_TO_DOMAIN: "respuestas.contacto.nano-bridge-mex.com",
  CORS_ORIGINS: "",
  TRUST_PROXY: "false",
  TOPE_DIARIO_CORREOS: "100000",
  NUEVOS_POR_DIA: "100000",
  STORAGE_DRIVER: "local",
  STORAGE_LOCAL_DIR: "./storage-e2e",
  CORREO_DRIVER: "falso",
  IA_DRIVER: "falso",
  CRM_URL: `http://localhost:${PUERTO_FRONT}`,
  PORT: String(PUERTO_API),
  SESSION_COOKIE_NAME: "nanobridge_session",
  SESSION_TTL_HOURS: "12",
  SENDGRID_WEBHOOK_PUBLIC_KEY: llaveSendgrid
};

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // La primera carga de la pantalla en modo desarrollo (Vite compila al vuelo) tarda.
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PUERTO_FRONT}`,
    locale: "es-MX",
    timezoneId: "America/Mexico_City",
    trace: "retain-on-failure"
  },
  // E2E_NAVEGADOR=chrome (o msedge) usa el navegador instalado en la compu en vez de bajar el Chromium de Playwright.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_NAVEGADOR || undefined } }],
  webServer: [
    {
      // Base vacía → migraciones → API compilada (npm run build en la raíz antes).
      command: "node e2e/crear-base.mjs && node ../node_modules/tsx/dist/cli.mjs ../src/database/migrate.ts && node ../dist/main.js",
      url: `http://localhost:${PUERTO_API}/health`,
      env: envApi,
      reuseExistingServer: false,
      timeout: 180_000
    },
    {
      command: `npx vite --port ${PUERTO_FRONT} --strictPort`,
      url: `http://localhost:${PUERTO_FRONT}`,
      env: { API_URL: `http://localhost:${PUERTO_API}` },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
