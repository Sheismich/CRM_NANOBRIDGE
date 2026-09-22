import { Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { ReportesService } from "./reportes.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { metricasDiariasQuerySchema, reporteExportableSchema, reporteQuerySchema } from "./dto/reporte.schema.js";

// Dashboards y reportes (PLAN_CRM_DEFINITIVO.md #9). Criterio de acceso
// (el plan no lo especifica para este módulo, así que se define aquí):
// solo administrador y supervisor -- el módulo 1 dice "El agente ve sus
// empresas, contactos, tareas y oportunidades asignadas" y "El supervisor
// ve la información de su equipo" (visión agregada), mientras que estos
// reportes cruzan datos de TODOS los agentes (conteos por responsable,
// pipeline completo). Un agente que quiere ver lo suyo ya tiene
// GET /oportunidades, /tareas y /cotizaciones filtrados a su propio
// responsable_id -- no necesita el mismo dato otra vez agregado aquí.
@Controller("api/v1/reportes")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador", "supervisor")
export class ReportesController {
  constructor(private readonly reportesService: ReportesService) {}

  @Get("actividades")
  actividadesPorAgente(@Query() query: Record<string, unknown>) {
    const input = reporteQuerySchema.parse(query);
    return this.reportesService.actividadesPorAgente(input);
  }

  @Get("tareas")
  tareas(@Query() query: Record<string, unknown>) {
    const input = reporteQuerySchema.parse(query);
    return this.reportesService.tareasReporte(input);
  }

  @Get("pipeline/conversion-etapas")
  conversionEtapas(@Query() query: Record<string, unknown>) {
    const input = reporteQuerySchema.parse(query);
    return this.reportesService.conversionEtapas(input);
  }

  @Get("pipeline/resumen")
  pipelineResumen(@Query() query: Record<string, unknown>) {
    const input = reporteQuerySchema.parse(query);
    return this.reportesService.pipelineResumen(input);
  }

  @Get("forecast")
  forecast(@Query() query: Record<string, unknown>) {
    const input = reporteQuerySchema.parse(query);
    return this.reportesService.forecastMensual(input);
  }

  // Tabla "Desempeño por agente": actividades + tareas cerradas/vencidas +
  // oportunidades ganadas/ingresos, ya unidas por agente en una sola
  // respuesta -- ver el comentario largo en ReportesService.desempenoPorAgente
  // sobre por qué hacía falta este endpoint en vez de componerlo en el
  // frontend a partir de /actividades, /tareas y /pipeline/resumen.
  @Get("desempeno-por-agente")
  desempenoPorAgente(@Query() query: Record<string, unknown>) {
    const input = reporteQuerySchema.parse(query);
    return this.reportesService.desempenoPorAgente(input);
  }

  // Histórico del job diario de métricas comerciales -- a diferencia de los
  // reportes de arriba (siempre calculados en vivo), esto lee la foto que
  // ya dejó calcularMetricasDelDia(), así que responde igual de rápido sin
  // importar el rango de fechas. Schema propio (sin responsableId): la
  // tabla es un agregado global, no por agente -- ver el comentario en
  // dto/reporte.schema.ts.
  @Get("metricas-diarias")
  metricasDiarias(@Query() query: Record<string, unknown>) {
    const input = metricasDiariasQuerySchema.parse(query);
    return this.reportesService.historicoMetricasDiarias(input);
  }

  // Recalcula la foto de HOY sin esperar al próximo @Interval -- mismo
  // criterio que POST /eventos-pendientes/despachar (forzar un job interno
  // a mano). Idempotente: repetirlo el mismo día solo actualiza esa fila.
  @Post("metricas-diarias/calcular")
  @HttpCode(200)
  calcularMetricasDelDia() {
    return this.reportesService.calcularMetricasDelDia();
  }

  // Exportación de reportes (PLAN_CRM_DEFINITIVO.md #9). @Res() sin
  // passthrough porque necesitamos escribir un Content-Type y
  // Content-Disposition propios (text/csv, attachment) en vez del JSON que
  // pone Nest por default -- distinto del @Res({ passthrough: true }) que
  // usa AuthController solo para poner una cookie y dejar que Nest siga
  // serializando la respuesta normal.
  @Get("export/:reporte")
  async exportar(@Param("reporte") reporteParam: string, @Query() query: Record<string, unknown>, @Res() response: Response) {
    const reporte = reporteExportableSchema.parse(reporteParam);
    const input = reporteQuerySchema.parse(query);
    const { nombreArchivo, contenido } = await this.reportesService.exportarCsv(reporte, input);
    response.status(200).set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${nombreArchivo}"`
    }).send(contenido);
  }
}
