import { z } from "zod";

export const listEventosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.enum(["pendiente", "procesando", "enviado", "fallido"]).optional()
});
