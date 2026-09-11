import { z } from "zod";

// Filtro común a todos los reportes: rango de fechas (ambos extremos
// opcionales -- sin filtro, el reporte cubre todo el historial) y agente.
// responsableId no se restringe por rol aquí: ReportesController ya exige
// administrador/supervisor (ver comentario ahí), así que cualquiera que
// llegue a este schema puede filtrar por cualquier agente, igual que
// OportunidadesService.list permite responsableId libre a esos roles.
export const reporteQuerySchema = z.object({
  fechaInicio: z.string().date().optional(),
  fechaFin: z.string().date().optional(),
  responsableId: z.coerce.number().int().positive().optional()
}).refine((input) => !input.fechaInicio || !input.fechaFin || input.fechaInicio <= input.fechaFin, {
  message: "fechaInicio debe ser anterior o igual a fechaFin",
  path: ["fechaFin"]
});
export type ReporteQuery = z.infer<typeof reporteQuerySchema>;

// Reportes disponibles para exportación CSV (GET /reportes/export/:reporte).
// Mismo set que los 5 endpoints de lectura -- ver ReportesController.
export const REPORTES_EXPORTABLES = ["actividades", "tareas", "conversion-etapas", "pipeline", "forecast"] as const;
export const reporteExportableSchema = z.enum(REPORTES_EXPORTABLES);
export type ReporteExportable = z.infer<typeof reporteExportableSchema>;
