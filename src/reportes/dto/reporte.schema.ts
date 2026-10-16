import { z } from "zod";
import { PERIODOS } from "../frases.js";

// Compartido por reporteQuerySchema y metricasDiariasQuerySchema, para que
// la regla de validación no pueda divergir entre los dos.
function fechaInicioAntesDeFechaFin(input: { fechaInicio?: string; fechaFin?: string }) {
  return !input.fechaInicio || !input.fechaFin || input.fechaInicio <= input.fechaFin;
}
const ERROR_RANGO_FECHA = { message: "fechaInicio debe ser anterior o igual a fechaFin", path: ["fechaFin"] };

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
}).refine(fechaInicioAntesDeFechaFin, ERROR_RANGO_FECHA);
export type ReporteQuery = z.infer<typeof reporteQuerySchema>;

// metricas_comerciales_diarias es un agregado global (job diario, sin
// dimensión por agente) -- sin responsableId, a diferencia de
// reporteQuerySchema.
export const metricasDiariasQuerySchema = z.object({
  fechaInicio: z.string().date().optional(),
  fechaFin: z.string().date().optional()
}).refine(fechaInicioAntesDeFechaFin, ERROR_RANGO_FECHA);
export type MetricasDiariasQuery = z.infer<typeof metricasDiariasQuerySchema>;

// Prospección (envíos y respuestas de n8n): no hay agente que filtrar --
// los correos los manda la automatización --, pero sí campaña.
export const prospeccionQuerySchema = z.object({
  fechaInicio: z.string().date().optional(),
  fechaFin: z.string().date().optional(),
  campanaId: z.coerce.number().int().positive().optional()
}).refine(fechaInicioAntesDeFechaFin, ERROR_RANGO_FECHA);
export type ProspeccionQuery = z.infer<typeof prospeccionQuerySchema>;

// Gráfica "correos enviados por día" del Inicio: aquí las dos fechas son
// obligatorias porque la respuesta trae un renglón por cada día del rango
// (los días sin envíos van en cero) y un rango abierto no tiene fin. Tope de
// 366 días: más que eso ya no se lee como gráfica por día.
const MAX_DIAS_POR_DIA = 366;
export const prospeccionPorDiaQuerySchema = z.object({
  fechaInicio: z.string().date(),
  fechaFin: z.string().date(),
  campanaId: z.coerce.number().int().positive().optional()
})
  .refine(fechaInicioAntesDeFechaFin, ERROR_RANGO_FECHA)
  .refine((q) => (Date.parse(q.fechaFin) - Date.parse(q.fechaInicio)) / 86_400_000 < MAX_DIAS_POR_DIA, { message: `El rango no puede pasar de ${MAX_DIAS_POR_DIA} días`, path: ["fechaFin"] });
export type ProspeccionPorDiaQuery = z.infer<typeof prospeccionPorDiaQuerySchema>;

// "Lo que acaba de pasar" del Inicio. `hasta` (día de México) corta el feed
// en ese día; sin él, es hasta ahora.
export const actividadRecienteQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  hasta: z.string().date().optional()
});
export type ActividadRecienteQuery = z.infer<typeof actividadRecienteQuerySchema>;

// Reportes · Día (bitácora, 11-oct-2026): un día de México, filtro por tipo
// de movimiento y por persona, con páginas.
export const TIPOS_BITACORA = ["tareas", "correos", "respuestas", "bajas", "documentos", "sistema"] as const;
export type TipoBitacora = (typeof TIPOS_BITACORA)[number];
export const reporteDiaQuerySchema = z.object({
  fecha: z.string().date(),
  tipo: z.enum(["todo", ...TIPOS_BITACORA]).default("todo"),
  usuarioId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
export type ReporteDiaQuery = z.infer<typeof reporteDiaQuerySchema>;

// Informe ejecutivo (bloque 6, 12-oct-2026): un mes de calendario de México
// (por omisión el actual) comparado contra el anterior, en PDF o CSV.
export const informeEjecutivoQuerySchema = z.object({
  formato: z.enum(["pdf", "csv"]).default("pdf"),
  mes: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "El mes va como AAAA-MM").optional(),
  responsableId: z.coerce.number().int().positive().optional()
});
export type InformeEjecutivoQuery = z.infer<typeof informeEjecutivoQuerySchema>;

// Reporte del periodo (16-oct-2026): el PDF del botón "Exportar" de
// Reportes. El periodo va hasta hoy, igual que la pantalla.
export const reportePeriodoQuerySchema = z.object({
  periodo: z.enum(PERIODOS).default("mes"),
  responsableId: z.coerce.number().int().positive().optional()
});
export type ReportePeriodoQuery = z.infer<typeof reportePeriodoQuerySchema>;

// Reportes disponibles para exportación CSV (GET /reportes/export/:reporte).
// Mismo set que los endpoints de lectura -- ver ReportesController. "dia" es
// la bitácora completa de un día (sin páginas).
export const REPORTES_EXPORTABLES = ["actividades", "tareas", "conversion-etapas", "pipeline", "forecast", "desempeno-por-agente", "prospeccion", "dia"] as const;
export const reporteExportableSchema = z.enum(REPORTES_EXPORTABLES);
export type ReporteExportable = z.infer<typeof reporteExportableSchema>;
