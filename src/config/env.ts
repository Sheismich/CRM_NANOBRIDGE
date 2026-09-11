import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1).default("nanobridge_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  CRM_CALLBACK_API_KEY: z.string().min(16),
  WEBHOOK_ENTRADA_API_KEY: z.string().min(16),
  // Despachador de eventos_pendientes (patrón outbox, PLAN_CRM_DEFINITIVO.md
  // #5): a dónde se entregan los eventos salientes hacia n8n. Sin configurar,
  // el despachador deja los eventos en 'fallido' tras agotar reintentos en
  // vez de intentar una URL inexistente.
  N8N_WEBHOOK_URL: z.string().url().optional(),
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  // Expediente documental (PLAN_CRM_DEFINITIVO.md #8). STORAGE_DRIVER
  // decide en runtime qué StorageService implementa
  // src/documentos/storage/storage.provider.ts:
  // - 'local' (default): guarda los archivos en disco bajo
  //   STORAGE_LOCAL_DIR y sirve descargas por
  //   src/documentos/storage/local-storage.controller.ts con una URL
  //   "firmada" (token HMAC de corta duración) propia -- no requiere un
  //   bucket real, así el proyecto funciona sin credenciales de GCS.
  // - 'gcs': usa @google-cloud/storage contra un bucket privado real
  //   (GCS_BUCKET obligatorio, credenciales del SDK de Google vía ADC o
  //   GCS_KEY_FILE) -- no probado en este entorno por falta de bucket y
  //   credenciales.
  STORAGE_DRIVER: z.enum(["local", "gcs"]).default("local"),
  // "Tamaño inicial máximo: 25 MB" (PLAN_CRM_DEFINITIVO.md #8), configurable.
  STORAGE_MAX_FILE_SIZE_MB: z.coerce.number().int().positive().max(1000).default(25),
  // Sin "documentos" al final: buildStorageKey() en DocumentosService ya
  // arma keys que empiezan con "documentos/<empresaId>/..." (mismo prefijo
  // que usaría un bucket real de GCS), así que el directorio base no debe
  // repetirlo.
  STORAGE_LOCAL_DIR: z.string().min(1).default("./storage"),
  // Firma las URLs "firmadas" locales (no hay bucket real que las emita).
  // Sin default, mismo criterio que CRM_CALLBACK_API_KEY/
  // WEBHOOK_ENTRADA_API_KEY: un secreto de firma no debe tener un valor
  // conocido de fábrica.
  STORAGE_LOCAL_SIGNING_SECRET: z.string().min(16),
  // "URLs firmadas de corta duración para descarga" (PLAN_CRM_DEFINITIVO.md
  // #8) -- aplica a ambos drivers (TTL que se le pide a GCS también).
  STORAGE_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
  // Solo obligatorios cuando STORAGE_DRIVER=gcs (ver superRefine abajo).
  // z.preprocess normaliza "" a undefined: .env.example los deja vacíos
  // (documentados, sin valor) cuando STORAGE_DRIVER=local -- una cadena
  // vacía no debe fallar min(1) igual que "no configurado" no debería.
  GCS_BUCKET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  GCS_PROJECT_ID: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),
  // Ruta a un archivo de credenciales de cuenta de servicio. Si se omite,
  // @google-cloud/storage cae a las Application Default Credentials del
  // entorno (gcloud CLI, metadata server de GCP, etc.), como documenta el
  // SDK oficial.
  GCS_KEY_FILE: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional())
}).superRefine((data, ctx) => {
  if (data.STORAGE_DRIVER === "gcs" && !data.GCS_BUCKET) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["GCS_BUCKET"], message: "GCS_BUCKET es obligatorio cuando STORAGE_DRIVER=gcs" });
  }
});

export const env = schema.parse(process.env);
