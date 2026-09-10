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
  OUTBOX_DISPATCH_INTERVAL_MS: z.coerce.number().int().positive().default(15000)
});

export const env = schema.parse(process.env);
