import { z } from "zod";

// Filtros de solo lectura sobre auditoria: cada uno opcional, se combinan
// con AND en AuditoriaService.list() vía compactConditions (mismo idioma
// que cotizaciones.service.ts/reportes.service.ts).
export const listarAuditoriaQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  entidad: z.string().trim().min(1).max(80).optional(),
  entidad_id: z.coerce.number().int().positive().optional(),
  usuario_id: z.coerce.number().int().positive().optional(),
  accion: z.string().trim().min(1).max(80).optional(),
  // ISO 8601 completo (fecha + hora): filtran creado_en con gte/lte, no
  // una fecha "de calendario" -- coherente con que auditoria.creado_en es
  // un datetime, no un date.
  desde: z.string().datetime().optional(),
  hasta: z.string().datetime().optional()
});
export type ListarAuditoriaQuery = z.infer<typeof listarAuditoriaQuerySchema>;
