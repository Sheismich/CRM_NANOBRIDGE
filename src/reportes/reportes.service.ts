import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { actividades, catalogoEtapaEmbudo, historialEtapaOportunidad, metricasComercialesDiarias, oportunidades, tareas, usuarios } from "../database/schema.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { HttpError } from "../shared/http-error.js";
import { toCsv } from "../shared/csv.js";
import type { MetricasDiariasQuery, ReporteExportable, ReporteQuery } from "./dto/reporte.schema.js";

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

// Igual criterio que toRow() en oportunidades.service.ts/cotizaciones.service.ts:
// la respuesta HTTP usa snake_case aunque las columnas de schema.ts estén en
// camelCase -- calcularMetricasDelDia() y historicoMetricasDiarias() comparten
// este mapeo para que las dos rutas devuelvan exactamente la misma forma.
function metricaDiariaToRow(row: typeof metricasComercialesDiarias.$inferSelect) {
  return {
    fecha: row.fecha,
    oportunidades_abiertas: row.oportunidadesAbiertas,
    valor_pipeline: row.valorPipeline,
    oportunidades_ganadas: row.oportunidadesGanadas,
    ingresos_cerrados: row.ingresosCerrados,
    oportunidades_perdidas: row.oportunidadesPerdidas,
    valor_perdido: row.valorPerdido,
    calculado_en: row.calculadoEn
  };
}

@Injectable()
export class ReportesService {
  private readonly logger = new Logger(ReportesService.name);

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

    // Se identifica la etapa de entrada por su clave ("calificada"), no
    // por orden===1: el número mágico se rompía si algún día se inserta
    // una etapa nueva antes de "calificada" y se renumera catalogo_etapa_
    // embudo.orden -- el reporte seguiría corriendo pero con el punto de
    // partida equivocado, sin ningún error visible (hallazgo de code
    // review, 14-sep-2026).
    const base = Number(rows.find((r) => r.etapaClave === "calificada")?.alcanzadas ?? 0);
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
    const condicionesFecha = condicionRangoFecha(oportunidades.actualizadoEn, query.fechaInicio, query.fechaFin);

    // Las tres consultas son independientes entre sí (ninguna depende del
    // resultado de otra), así que se corren en paralelo en vez de
    // esperarlas una tras otra (hallazgo de code review, 11-sep-2026).
    const [abiertas, ganadas, perdidas] = await Promise.all([
      this.contarOportunidadesAbiertas(condicionResponsable),
      this.contarOportunidadesCerradas(true, condicionResponsable, ...condicionesFecha),
      this.contarOportunidadesCerradas(false, condicionResponsable, ...condicionesFecha)
    ]);

    return {
      abiertas: { cantidad: abiertas.cantidad, valor_pipeline: abiertas.valor },
      ganadas: { cantidad: ganadas.cantidad, ingresos_cerrados: ganadas.valor },
      perdidas: { cantidad: perdidas.cantidad, valor_perdido: perdidas.valor }
    };
  }

  // Compartido por pipelineResumen() y calcularMetricasDelDia(): "abiertas"
  // es la MISMA foto del momento en los dos casos (sin rango de fechas),
  // solo que aquí nunca se filtra por responsable -- antes estaba copiada
  // verbatim en los dos métodos (hallazgo de code-review, 15-sep-2026): si
  // la definición de "abierta" cambia algún día, había que acordarse de
  // tocar los dos lados.
  private async contarOportunidadesAbiertas(condicionResponsable: ReturnType<typeof eq> | undefined) {
    const [row] = await this.db
      .select({ cantidad: sql<number>`COUNT(*)`, valor: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)` })
      .from(oportunidades)
      .where(and(eq(oportunidades.cerrada, false), ...(condicionResponsable ? [condicionResponsable] : [])));
    return { cantidad: Number(row.cantidad), valor: row.valor };
  }

  // Mismo motivo que contarOportunidadesAbiertas(): "ganada"/"perdida" son
  // la misma cuenta (cerrada=true + catalogo_etapa_embudo.es_ganada) tanto
  // en pipelineResumen() (con responsable/rango de fechas opcionales) como
  // en calcularMetricasDelDia() (siempre "hoy") -- antes estaba copiada en
  // los dos (hallazgo de code-review, 15-sep-2026).
  private async contarOportunidadesCerradas(esGanada: boolean, ...condicionesExtra: (ReturnType<typeof eq> | undefined)[]) {
    const [row] = await this.db
      .select({ cantidad: sql<number>`COUNT(*)`, valor: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)` })
      .from(oportunidades)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(and(eq(oportunidades.cerrada, true), eq(catalogoEtapaEmbudo.esGanada, esGanada), ...compactConditions(condicionesExtra)));
    return { cantidad: Number(row.cantidad), valor: row.valor };
  }

  // Job diario de métricas comerciales (PLAN_API_DEFINITIVO.md, "Jobs
  // internos"; tabla metricas_comerciales_diarias, PLAN_CRM_DEFINITIVO.md):
  // pipelineResumen() de arriba es siempre en vivo, sin foto histórica de
  // "cómo estaba el pipeline el día X". @Interval fijo (no env var), mismo
  // criterio que ProspectosService.limpiarBorradoresVencidos.
  //
  // "hoy" se resuelve UNA sola vez en MySQL (no Node, por el desfase de
  // zona horaria de siempre) y se reusa en el filtro de ganadas/perdidas,
  // el UPSERT y el valor devuelto -- evaluar CURDATE() por separado en
  // cada consulta podía escribir en un día y no encontrar la fila si la
  // corrida caía justo a medianoche (hallazgo de code-review, 15-sep-2026).
  //
  // No relee la fila después del UPSERT: dos invocaciones (el @Interval y
  // el endpoint manual de abajo) pueden solaparse, y una relectura después
  // de escribir no es atómica con la propia escritura -- se devuelve
  // directo lo que esta invocación calculó, con el mismo `calculadoEn`
  // forzado en el INSERT/UPDATE (no vía el ON UPDATE CURRENT_TIMESTAMP de
  // la columna, que MySQL no dispara si nada más cambió) y en la respuesta.
  // Sigue existiendo una carrera de "última escritura gana" entre dos
  // invocaciones concurrentes -- aceptada a propósito: es una foto
  // informativa que se autocorrige en la siguiente corrida, no un
  // invariante de negocio que amerite un lock como el de usuarios.service.ts.
  @Interval(24 * 60 * 60 * 1000)
  async calcularMetricasDelDia() {
    const [rows] = (await this.db.execute<{ hoy: string }[]>(sql`SELECT CURDATE() AS hoy`)) as unknown as [{ hoy: string }[], unknown];
    const hoy = rows[0]!.hoy;

    const condicionHoy = sql`DATE(${oportunidades.actualizadoEn}) = ${hoy}`;
    const [abiertas, ganadas, perdidas] = await Promise.all([
      this.contarOportunidadesAbiertas(undefined),
      this.contarOportunidadesCerradas(true, condicionHoy),
      this.contarOportunidadesCerradas(false, condicionHoy)
    ]);

    const valores = {
      oportunidadesAbiertas: abiertas.cantidad,
      valorPipeline: abiertas.valor,
      oportunidadesGanadas: ganadas.cantidad,
      ingresosCerrados: ganadas.valor,
      oportunidadesPerdidas: perdidas.cantidad,
      valorPerdido: perdidas.valor
    };
    const calculadoEn = new Date();

    await this.db
      .insert(metricasComercialesDiarias)
      .values({ fecha: hoy, ...valores, calculadoEn })
      .onDuplicateKeyUpdate({ set: { ...valores, calculadoEn } });

    this.logger.log(`Métricas comerciales del ${hoy} calculadas: ${valores.oportunidadesAbiertas} abiertas, ${valores.oportunidadesGanadas} ganadas, ${valores.oportunidadesPerdidas} perdidas`);
    return metricaDiariaToRow({ fecha: hoy, ...valores, calculadoEn });
  }

  // Lectura del histórico que deja calcularMetricasDelDia() -- a diferencia
  // del resto de este servicio, no hay responsableId (la tabla es un
  // agregado diario, no por agente).
  async historicoMetricasDiarias(query: MetricasDiariasQuery) {
    const condiciones = compactConditions([
      query.fechaInicio ? gte(metricasComercialesDiarias.fecha, query.fechaInicio) : undefined,
      query.fechaFin ? lte(metricasComercialesDiarias.fecha, query.fechaFin) : undefined
    ]);

    const rows = await this.db
      .select()
      .from(metricasComercialesDiarias)
      .where(condiciones.length > 0 ? and(...condiciones) : undefined)
      .orderBy(desc(metricasComercialesDiarias.fecha));

    return rows.map(metricaDiariaToRow);
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
        // headers explícito: datos puede venir vacío (sin actividades en
        // el rango pedido) y sin esto el CSV salía sin encabezado, a
        // diferencia de cualquier exportación con resultados (hallazgo de
        // code review, 14-sep-2026) -- igual en los otros dos casos de
        // abajo que también pueden venir vacíos.
        return { nombreArchivo: "actividades_por_agente.csv", contenido: toCsv(datos, ["responsable_id", "responsable_nombre", "llamada", "whatsapp", "comentario", "total"]) };
      }
      case "tareas": {
        const datos = await this.tareasReporte(query);
        const filas = [
          ...datos.cerradas.por_tipo.map((f) => ({ categoria: "cerrada", tipo: f.tipo, cantidad: f.cantidad })),
          ...datos.vencidas.por_tipo.map((f) => ({ categoria: "vencida", tipo: f.tipo, cantidad: f.cantidad }))
        ];
        return { nombreArchivo: "tareas_cerradas_vencidas.csv", contenido: toCsv(filas, ["categoria", "tipo", "cantidad"]) };
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
        return { nombreArchivo: "forecast_mensual.csv", contenido: toCsv(datos, ["mes", "cantidad", "valor_estimado_total", "valor_ponderado"]) };
      }
      default: {
        const exhaustivo: never = reporte;
        throw new HttpError(400, `Reporte desconocido: ${String(exhaustivo)}`);
      }
    }
  }
}
