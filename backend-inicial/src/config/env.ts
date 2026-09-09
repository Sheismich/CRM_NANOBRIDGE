import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  SESSION_COOKIE_NAME: z.string().min(1).default("nanobridge_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  CRM_CALLBACK_API_KEY: z.string().min(16),
  WEBHOOK_ENTRADA_API_KEY: z.string().min(16)
});

export const env = schema.parse(process.env);
