import { z } from "zod";

export const credentialsSchema = z.object({
  correo: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128)
});

export const bootstrapSchema = credentialsSchema.extend({
  nombre: z.string().trim().min(2).max(160)
});
