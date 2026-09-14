import { z } from "zod";

export const listProcesosFallidosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.enum(["abierto", "en_revision", "resuelto"]).optional(),
  tipo: z.string().trim().min(1).max(100).optional()
});
export type ListProcesosFallidosQuery = z.infer<typeof listProcesosFallidosQuerySchema>;

export const actualizarEstadoProcesoFallidoSchema = z.object({
  estado: z.enum(["abierto", "en_revision", "resuelto"])
});
export type ActualizarEstadoProcesoFallidoInput = z.infer<typeof actualizarEstadoProcesoFallidoSchema>;
