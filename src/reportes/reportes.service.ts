import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { actividades, catalogoEtapaEmbudo, historialEtapaOportunidad, oportunidades, tareas, usuarios } from "../database/schema.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { HttpError } from "../shared/http-error.js";
import { toCsv } from "../shared/csv.js";
import type { ReporteExportable, ReporteQuery } from "./dto/reporte.schema.js";

// Dashboards y reportes (PLAN_CRM_DEFINITIVO.md #9). A diferencia de los
// demás módulos comerciales, aquí no hay "scoping por responsable" en el
// sentido de ocultar filas de otros agentes -- ReportesController ya
// restringe el acceso a administrador/supervisor (ver comentario en el
// controller), así que responsableId en la query es solo un filtro
// opcional, nunca una restricción de visibilidad.

function condicionRangoFecha(columna: unknown, fechaInicio?: string, fechaFin?: string) {
  const condiciones = [];
  if (fechaInicio) condiciones.push(sql`DATE(${columna}) >= ${fechaInicio}`);
  if (fechaFin) condiciones.push(sql`DATE(${columna}) <= ${fechaFin}`);
  return condiciones;
}

@Injectable()
export class ReportesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // "Actividades por agente" (PLAN_CRM_DEFINITIVO.md #9) -- cuenta cada
  // llamada/whatsapp/comentario registrado en `actividades` (módulo 4),
  // agrupado por responsable y tipo, en el rango de ocurrida_en dado.
  async actividadesPorAgente(query: ReporteQuery) {
    const condiciones = compactConditions([
      query.responsableId ? eq(actividades.responsableId, query.responsableId) : undefined,
      ...condicionRangoFecha(actividades.ocurridaEn, query.fechaInicio, query.fechaFin)
    ]);

    const rows = await this.db
      .select({
        responsableId: actividades.responsableId,
        responsableNombre: usuarios.nombre,
        tipo: actividades.tipo,
        cantidad: sql<number>`COUNT(*)`
      })
      .from(actividades)
      .innerJoin(usuarios, eq(usuarios.id, actividades.responsableId))
      .where(condiciones.length > 0 ? and(...condiciones) : undefined)
      .groupBy(actividades.responsableId, usuarios.nombre, actividades.tipo)
      .orderBy(usuarios.nombre, actividades.tipo);

    const porAgente = new Map<number, { responsable_id: number; responsable_nombre: string; llamada: number; whatsapp: number; comentario: number; total: number }>();
    for (const row of rows) {
      const cantidad = Number(row.cantidad);
      const entry = porAgente.get(row.responsableId) ?? { responsable_id: row.responsableId, responsable_nombre: row.responsableNombre, llamada: 0, whatsapp: 0, comentario: 0, total: 0 };
      entry[row.tipo] = cantidad;
      entry.total += cantidad;
      porAgente.set(row.responsableId, entry);
    }
    return [...porAgente.values()];
  }

  // "Tareas cerradas y vencidas" (PLAN_CRM_DEFINITIVO.md #9). El rango de
  // fechas aplica solo a "cerradas" (filtra por cerrada_en: cuándo se
  // cerraron). "vencidas" es una foto del momento -- tareas con
  // fecha_limite ya pasada que siguen sin cerrarse hoy -- y no depende del
  // rango: no tiene sentido preguntar "cuáles estaban vencidas entre el 1
  // y el 5" sin repetir el cálculo día por día, así que siempre se reporta
  // el estado actual, igual que TareasService.findAssignable trata
  // 'vencida' como algo que se evalúa contra el reloj, no contra el pasado.
  async tareasReporte(query: ReporteQuery) {
    const condicionesCerradas = compactConditions([
      eq(tareas.estado, "cerrada"),
      query.responsableId ? eq(tareas.responsableId, query.responsableId) : undefined,
      ...condicionRangoFecha(tareas.cerradaEn, query.fechaInicio, query.fechaFin)
    ]);

    const condicionesVencidas = compactConditions([
      sql`${tareas.fechaLimite} < CURRENT_TIMESTAMP`,
      sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`,
      query.responsableId ? eq(tareas.responsableId, query.responsableId) : undefined
    ]);

    // "cerradas" y "vencidas" son dos queries independientes sobre la
    // misma tabla -- ninguna depende del resultado de la otra, así que se
    // corren en paralelo en vez de esperar una tras otra (hallazgo de code
    // review, 11-sep-2026).
    const [cerradasPorTipo, vencidasPorTipo] = await Promise.all([
      this.db
        .select({ tipo: tareas.tipo, cantidad: sql<number>`COUNT(*)` })
        .from(tareas)
        .where(and(...condicionesCerradas))
        .groupBy(tareas.tipo)
        .orderBy(tareas.tipo),
      this.db
        .select({ tipo: tareas.tipo, cantidad: sql<number>`COUNT(*)` })
        .from(tareas)
        .where(and(...condicionesVencidas))
        .groupBy(tareas.tipo)
        .orderBy(tareas.tipo)
    ]);

    const totalizar = (filas: { tipo: string; cantidad: number }[]) => filas.reduce((acc, f) => acc + Number(f.cantidad), 0);

    return {
      cerradas: {
        total: totalizar(cerradasPorTipo),
        por_tipo: cerradasPorTipo.map((f) => ({ tipo: f.tipo, cantidad: Number(f.cantidad) }))
      },
      vencidas: {
        total: totalizar(vencidasPorTipo),
        por_tipo: vencidasPorTipo.map((f) => ({ tipo: f.tipo, cantidad: Number(f.cantidad) }))
      }
    };
  }

  // "Conversiones por etapa" (PLAN_CRM_DEFINITIVO.md #9), a partir del
  // pipeline de oportunidades (módulo 6). Por cada etapa del embudo,
  // cuenta cuántas oportunidades distintas pasaron por ella alguna vez
  // (historial_etapa_oportunidad) y calcula qué porcentaje representa
  // sobre las que entraron al embudo (etapa "calificada", la primera). La
  // etapa "perdida" se reporta aparte porque no es un avance del embudo,
  // es una salida.
  async conversionEtapas(query: ReporteQuery) {
    const condiciones = compactConditions([
      query.responsableId ? eq(oportunidades.responsableId, query.responsableId) : undefined,
      ...condicionRangoFecha(historialEtapaOportunidad.creadoEn, query.fechaInicio, query.fechaFin)
    ]);

    const rows = await this.db
      .select({
        etapaClave: catalogoEtapaEmbudo.clave,
        etapaNombre: catalogoEtapaEmbudo.nombre,
        orden: catalogoEtapaEmbudo.orden,
        alcanzadas: sql<number>`COUNT(DISTINCT ${historialEtapaOportunidad.oportunidadId})`
      })
      .from(historialEtapaOportunidad)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, historialEtapaOportunidad.etapaId))
      .innerJoin(oportunidades, eq(oportunidades.id, historialEtapaOportunidad.oportunidadId))
      .where(condiciones.length > 0 ? and(...condiciones) : undefined)
      .groupBy(catalogoEtapaEmbudo.id, catalogoEtapaEmbudo.clave, catalogoEtapaEmbudo.nombre, catalogoEtapaEmbudo.orden)
      .orderBy(catalogoEtapaEmbudo.orden);

    const base = Number(rows.find((r) => r.orden === 1)?.alcanzadas ?? 0);
    const etapas = rows
      .filter((r) => r.etapaClave !== "perdida")
      .map((r) => ({
        etapa_clave: r.etapaClave,
        etapa_nombre: r.etapaNombre,
        orden: r.orden,
        oportunidades_alcanzadas: Number(r.alcanzadas),
        conversion_desde_calificada_pct: base > 0 ? Number(((Number(r.alcanzadas) / base) * 100).toFixed(2)) : null
      }));
    const perdidaRow = rows.find((r) => r.etapaClave === "perdida");

    return {
      base_calificadas: base,
      etapas,
      perdidas: {
        oportunidades: Number(perdidaRow?.alcanzadas ?? 0),
        tasa_perdida_pct: base > 0 ? Number(((Number(perdidaRow?.alcanzadas ?? 0) / base) * 100).toFixed(2)) : null
      }
    };
  }

  // "Oportunidades abiertas, ganadas y perdidas", "Ingresos cerrados" y
  // "Valor de pipeline" (PLAN_CRM_DEFINITIVO.md #9): se combinan en un solo
  // reporte porque las tres salen de la misma tabla `oportunidades`
  // particionada por estado. "Valor de pipeline" es una foto del momento
  // (las oportunidades abiertas ahora mismo, sin importar cuándo se
  // crearon) -- por eso "abiertas" NO aplica el rango de fechas. "Ganadas"
  // y "perdidas" sí lo aplican sobre actualizado_en, que es cuándo se
  // cerraron (OportunidadesService.cambiarEtapa es la única escritura que
  // toca una oportunidad después de crearla, así que actualizado_en de una
  // oportunidad cerrada equivale a su fecha de cierre). No existe un campo
  // de "monto realmente cobrado" en el esquema, así que "ingresos
  // cerrados" se calcula como la suma de valor_estimado de las ganadas.
  async pipelineResumen(query: ReporteQuery) {
    const condicionResponsable = query.responsableId ? eq(oportunidades.responsableId, query.responsableId) : undefined;

    const condicionesCierre = compactConditions([
      eq(oportunidades.cerrada, true),
      condicionResponsable,
      ...condicionRangoFecha(oportunidades.actualizadoEn, query.fechaInicio, query.fechaFin)
    ]);

    // Las tres consultas son independientes entre sí (ninguna depende del
    // resultado de otra), así que se corren en paralelo en vez de
    // esperarlas una tras otra (hallazgo de code review, 11-sep-2026).
    const [[abiertas], [ganadas], [perdidas]] = await Promise.all([
      this.db
        .select({ cantidad: sql<number>`COUNT(*)`, valor: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)` })
        .from(oportunidades)
        .where(and(eq(oportunidades.cerrada, false), ...(condicionResponsable ? [condicionResponsable] : []))),
      this.db
        .select({ cantidad: sql<number>`COUNT(*)`, valor: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)` })
        .from(oportunidades)
        .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
        .where(and(...condicionesCierre, eq(catalogoEtapaEmbudo.esGanada, true))),
      this.db
        .select({ cantidad: sql<number>`COUNT(*)`, valor: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)` })
        .from(oportunidades)
        .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
        .where(and(...condicionesCierre, eq(catalogoEtapaEmbudo.esGanada, false)))
    ]);

    return {
      abiertas: { cantidad: Number(abiertas.cantidad), valor_pipeline: abiertas.valor },
      ganadas: { cantidad: Number(ganadas.cantidad), ingresos_cerrados: ganadas.valor },
      perdidas: { cantidad: Number(perdidas.cantidad), valor_perdido: perdidas.valor }
    };
  }

  // "Forecast mensual: monto por probabilidad y fecha estimada de cierre"
  // (PLAN_CRM_DEFINITIVO.md #9). Definición adoptada (el plan no la detalla
  // más): solo oportunidades abiertas con fecha_cierre_estimada capturada,
  // agrupadas por mes de esa fecha. Por mes se reporta el monto nominal
  // (suma de valor_estimado) y el monto ponderado por probabilidad de la
  // etapa actual (valor_estimado * probabilidad / 100) -- el forecast
  // "realista" estándar de un pipeline por embudo de probabilidades.
  async forecastMensual(query: ReporteQuery) {
    const condiciones = compactConditions([
      eq(oportunidades.cerrada, false),
      isNotNull(oportunidades.fechaCierreEstimada),
      query.responsableId ? eq(oportunidades.responsableId, query.responsableId) : undefined,
      ...condicionRangoFecha(oportunidades.fechaCierreEstimada, query.fechaInicio, query.fechaFin)
    ]);

    const mes = sql<string>`DATE_FORMAT(${oportunidades.fechaCierreEstimada}, '%Y-%m')`;

    const rows = await this.db
      .select({
        mes,
        cantidad: sql<number>`COUNT(*)`,
        valorEstimadoTotal: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)`,
        valorPonderado: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado} * ${catalogoEtapaEmbudo.probabilidad} / 100), 0)`
      })
      .from(oportunidades)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(and(...condiciones))
      .groupBy(mes)
      .orderBy(mes);

    return rows.map((r) => ({
      mes: r.mes,
      cantidad: Number(r.cantidad),
      valor_estimado_total: r.valorEstimadoTotal,
      valor_ponderado: r.valorPonderado
    }));
  }

  // Exportación de reportes (PLAN_CRM_DEFINITIVO.md #9): reusa los mismos
  // métodos de arriba y aplana su resultado a filas para toCsv(). Cada
  // reporte tiene su propia forma (uno es lista plana, otros son objetos
  // con sub-secciones), así que el aplanado es específico por reporte.
  async exportarCsv(reporte: ReporteExportable, query: ReporteQuery): Promise<{ nombreArchivo: string; contenido: string }> {
    switch (reporte) {
      case "actividades": {
        const datos = await this.actividadesPorAgente(query);
        return { nombreArchivo: "actividades_por_agente.csv", contenido: toCsv(datos) };
      }
      case "tareas": {
        const datos = await this.tareasReporte(query);
        const filas = [
          ...datos.cerradas.por_tipo.map((f) => ({ categoria: "cerrada", tipo: f.tipo, cantidad: f.cantidad })),
          ...datos.vencidas.por_tipo.map((f) => ({ categoria: "vencida", tipo: f.tipo, cantidad: f.cantidad }))
        ];
        return { nombreArchivo: "tareas_cerradas_vencidas.csv", contenido: toCsv(filas) };
      }
      case "conversion-etapas": {
        const datos = await this.conversionEtapas(query);
        const filas = [
          ...datos.etapas,
          { etapa_clave: "perdida", etapa_nombre: "Perdida", orden: null, oportunidades_alcanzadas: datos.perdidas.oportunidades, conversion_desde_calificada_pct: datos.perdidas.tasa_perdida_pct }
        ];
        return { nombreArchivo: "conversion_por_etapa.csv", contenido: toCsv(filas) };
      }
      case "pipeline": {
        const datos = await this.pipelineResumen(query);
        const filas = [
          { categoria: "abiertas", cantidad: datos.abiertas.cantidad, valor: datos.abiertas.valor_pipeline },
          { categoria: "ganadas", cantidad: datos.ganadas.cantidad, valor: datos.ganadas.ingresos_cerrados },
          { categoria: "perdidas", cantidad: datos.perdidas.cantidad, valor: datos.perdidas.valor_perdido }
        ];
        return { nombreArchivo: "pipeline_resumen.csv", contenido: toCsv(filas) };
      }
      case "forecast": {
        const datos = await this.forecastMensual(query);
        return { nombreArchivo: "forecast_mensual.csv", contenido: toCsv(datos) };
      }
      default: {
        const exhaustivo: never = reporte;
        throw new HttpError(400, `Reporte desconocido: ${String(exhaustivo)}`);
      }
    }
  }
}
