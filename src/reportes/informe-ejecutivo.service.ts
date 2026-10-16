import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, metricasComercialesDiarias, usuarios } from "../database/schema.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { toCsv } from "../shared/csv.js";
import { diaSiguiente, fechaMx, inicioDelDiaMxSql } from "../shared/dia-habil.js";
import { COLOR, FUENTE, MARGEN, anchoUtil, asegurarEspacio, crearDocumentoCarta, seccion, tabla, tarjetas, terminar, type DocumentoPdf, type TarjetaDato } from "../shared/pdf/molde.js";
import { dineroCorto, dineroEntero, fechaHoraMx, mesCorto, mesLargo, numero, porcentaje } from "../shared/pdf/formato.js";
import { ReportesService } from "./reportes.service.js";
import { barrasEtapas, graficaForecast } from "./pdf-graficas.js";
import type { InformeEjecutivoQuery } from "./dto/reporte.schema.js";

// Informe ejecutivo (bloque 6, 12-oct-2026; punto 46; diseño en
// docs/diseno/informe-ejecutivo.html): el botón de Oportunidades. Un mes de
// México comparado contra el anterior, en PDF (una hoja carta) o en CSV
// (los mismos números en renglones).
//
// Todo sale de los reportes que ya existen en ReportesService -- mismo
// número que la pantalla de Reportes con ese mes --, salvo dos cosas que no
// tenía ningún reporte:
// - bajas del mes: personas distintas que pasaron a "baja" (auditoría del
//   prospecto, el mismo criterio que actividadReciente y Reportes · Día);
// - pipeline del mes anterior: el pipeline abierto es una foto del momento,
//   así que para compararlo se usa la foto del job diario de métricas del
//   último día del mes anterior. Esa tabla es global (sin agente): con
//   filtro de responsable no hay contra qué comparar.
//
// "Tareas vencidas" es la foto de hoy, como en /reportes/tareas. La
// prospección es siempre de todos: los correos son de campaña, no de un
// agente (el PDF lo aclara con una nota cuando hay filtro).

const MESES_FORECAST = 5;

interface Comparado<T> {
  valor: T;
  mes_anterior: T | null;
}

export interface DatosInforme {
  mes: string;
  mes_anterior: string;
  responsable: { id: number; nombre: string } | null;
  resumen: {
    pipeline_abierto: Comparado<string | null>;
    oportunidades_abiertas: number;
    ganado: Comparado<string>;
    cierres: Comparado<number>;
    tasa_respuesta_pct: Comparado<number | null>;
    tareas_vencidas_hoy: number;
  };
  conversion: {
    tasa_pct: number | null;
    base_calificadas: number;
    ciclo_medio_dias: number | null;
    etapas: { clave: string; nombre: string; alcanzadas: number; pct: number | null }[];
  };
  forecast: { mes: string; cantidad: number; valor_total: string; valor_ponderado: string }[];
  prospeccion: {
    contactadas: Comparado<number>;
    respondieron: Comparado<number>;
    interesados: Comparado<number>;
    bajas: Comparado<number>;
  };
  agentes: { nombre: string; actividades: number; tareas_cerradas: number; vencidas: number; ganado: string }[];
}

function ultimoDia(mes: string) {
  const [anio, numeroMes] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(anio, numeroMes, 0)).toISOString().slice(0, 10);
}

function sumarMeses(mes: string, meses: number) {
  const [anio, numeroMes] = mes.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(anio, numeroMes - 1 + meses, 1));
  return d.toISOString().slice(0, 7);
}

@Injectable()
export class InformeEjecutivoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly reportesService: ReportesService
  ) {}

  async datos(query: InformeEjecutivoQuery): Promise<DatosInforme> {
    const mesActual = fechaMx(new Date()).slice(0, 7);
    const mes = query.mes ?? mesActual;
    const anterior = sumarMeses(mes, -1);
    const rango = { fechaInicio: `${mes}-01`, fechaFin: ultimoDia(mes), responsableId: query.responsableId };
    const rangoAnterior = { fechaInicio: `${anterior}-01`, fechaFin: ultimoDia(anterior), responsableId: query.responsableId };
    const sinAgente = (r: typeof rango) => ({ fechaInicio: r.fechaInicio, fechaFin: r.fechaFin });

    const [pipeline, pipelineAnterior, tareas, prospeccion, prospeccionAnterior, conversion, forecast, desempeno, bajas, bajasAnterior, responsable] = await Promise.all([
      this.reportesService.pipelineResumen(rango),
      this.reportesService.pipelineResumen(rangoAnterior),
      this.reportesService.tareasReporte(rango),
      this.reportesService.prospeccion(sinAgente(rango)),
      this.reportesService.prospeccion(sinAgente(rangoAnterior)),
      this.reportesService.conversionEtapas(rango),
      this.reportesService.forecastMensual({ fechaInicio: `${mes}-01`, fechaFin: ultimoDia(sumarMeses(mes, MESES_FORECAST - 1)), responsableId: query.responsableId }),
      this.reportesService.desempenoPorAgente(rango),
      this.contarBajas(rango.fechaInicio, rango.fechaFin),
      this.contarBajas(rangoAnterior.fechaInicio, rangoAnterior.fechaFin),
      query.responsableId ? this.nombreDe(query.responsableId) : Promise.resolve(null)
    ]);

    // Pipeline: el de hoy si el informe es del mes en curso; de un mes
    // pasado, la foto de su último día (sin filtro de agente).
    const [fotoAnterior, fotoDelMes] = await Promise.all([
      query.responsableId ? null : this.fotoPipeline(anterior),
      query.responsableId || mes === mesActual ? null : this.fotoPipeline(mes)
    ]);
    const pipelineDelMes = mes === mesActual ? pipeline.abiertas.valor_pipeline : fotoDelMes;

    // Personas distintas: sumar las campañas contaría dos veces a quien está en dos.
    const interesados = (p: typeof prospeccion) => p.respuestas.personas_interesadas;
    const ganada = conversion.etapas.find((e) => e.etapa_clave === "ganada");
    const porMes = new Map(forecast.map((f) => [f.mes, f]));

    return {
      mes,
      mes_anterior: anterior,
      responsable: query.responsableId ? { id: query.responsableId, nombre: responsable ?? `#${query.responsableId}` } : null,
      resumen: {
        pipeline_abierto: { valor: pipelineDelMes, mes_anterior: fotoAnterior },
        oportunidades_abiertas: pipeline.abiertas.cantidad,
        ganado: { valor: pipeline.ganadas.ingresos_cerrados, mes_anterior: pipelineAnterior.ganadas.ingresos_cerrados },
        cierres: { valor: pipeline.ganadas.cantidad, mes_anterior: pipelineAnterior.ganadas.cantidad },
        tasa_respuesta_pct: { valor: prospeccion.tasa_respuesta_pct, mes_anterior: prospeccionAnterior.tasa_respuesta_pct },
        tareas_vencidas_hoy: tareas.vencidas.total
      },
      conversion: {
        tasa_pct: ganada?.conversion_desde_calificada_pct ?? null,
        base_calificadas: conversion.base_calificadas,
        ciclo_medio_dias: conversion.ciclo_medio_venta.dias,
        etapas: conversion.etapas.map((e) => ({ clave: e.etapa_clave, nombre: e.etapa_nombre, alcanzadas: e.oportunidades_alcanzadas, pct: e.conversion_desde_calificada_pct }))
      },
      forecast: Array.from({ length: MESES_FORECAST }, (_, i) => {
        const m = sumarMeses(mes, i);
        const fila = porMes.get(m);
        return { mes: m, cantidad: fila?.cantidad ?? 0, valor_total: fila?.valor_estimado_total ?? "0.00", valor_ponderado: fila?.valor_ponderado ?? "0.00" };
      }),
      prospeccion: {
        contactadas: { valor: prospeccion.envios.personas_contactadas, mes_anterior: prospeccionAnterior.envios.personas_contactadas },
        respondieron: { valor: prospeccion.respuestas.personas_que_respondieron, mes_anterior: prospeccionAnterior.respuestas.personas_que_respondieron },
        interesados: { valor: interesados(prospeccion), mes_anterior: interesados(prospeccionAnterior) },
        bajas: { valor: bajas, mes_anterior: bajasAnterior }
      },
      agentes: desempeno.map((d) => ({
        nombre: d.responsable_nombre,
        actividades: d.actividades.total,
        tareas_cerradas: d.tareas.cerradas,
        vencidas: d.tareas.vencidas,
        ganado: d.oportunidades.ingresos_cerrados
      }))
    };
  }

  private async contarBajas(fechaInicio: string, fechaFin: string) {
    const [fila] = await this.db
      .select({ personas: sql<number>`COUNT(DISTINCT ${auditoria.entidadId})` })
      .from(auditoria)
      .where(and(
        eq(auditoria.entidad, "prospecto"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${auditoria.despues}, '$.estado')) = 'baja'`,
        sql`${auditoria.creadoEn} >= ${inicioDelDiaMxSql(fechaInicio)}`,
        sql`${auditoria.creadoEn} < ${inicioDelDiaMxSql(diaSiguiente(fechaFin))}`
      ));
    return Number(fila?.personas ?? 0);
  }

  // La foto más reciente del job diario dentro de ese mes.
  private async fotoPipeline(mes: string) {
    const [fila] = await this.db
      .select({ valor: metricasComercialesDiarias.valorPipeline })
      .from(metricasComercialesDiarias)
      .where(and(gte(metricasComercialesDiarias.fecha, `${mes}-01`), lte(metricasComercialesDiarias.fecha, ultimoDia(mes))))
      .orderBy(desc(metricasComercialesDiarias.fecha))
      .limit(1);
    return fila?.valor ?? null;
  }

  private async nombreDe(usuarioId: number) {
    const [fila] = await this.db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
    return fila?.nombre ?? null;
  }

  async csv(query: InformeEjecutivoQuery) {
    const d = await this.datos(query);
    const filas: { seccion: string; indicador: string; valor: string | number | null; mes_anterior: string | number | null }[] = [];
    const agregar = (seccion: string, indicador: string, valor: string | number | null, mesAnterior: string | number | null = null) => filas.push({ seccion, indicador, valor, mes_anterior: mesAnterior });

    agregar("informe", "mes", d.mes, d.mes_anterior);
    agregar("informe", "responsable", d.responsable?.nombre ?? "todos");
    agregar("resumen", "pipeline_abierto", d.resumen.pipeline_abierto.valor, d.resumen.pipeline_abierto.mes_anterior);
    agregar("resumen", "oportunidades_abiertas", d.resumen.oportunidades_abiertas);
    agregar("resumen", "ganado", d.resumen.ganado.valor, d.resumen.ganado.mes_anterior);
    agregar("resumen", "cierres", d.resumen.cierres.valor, d.resumen.cierres.mes_anterior);
    agregar("resumen", "tasa_respuesta_pct", d.resumen.tasa_respuesta_pct.valor, d.resumen.tasa_respuesta_pct.mes_anterior);
    agregar("resumen", "tareas_vencidas_hoy", d.resumen.tareas_vencidas_hoy);
    agregar("conversion", "tasa_conversion_pct", d.conversion.tasa_pct);
    agregar("conversion", "base_calificadas", d.conversion.base_calificadas);
    agregar("conversion", "ciclo_medio_dias", d.conversion.ciclo_medio_dias);
    for (const etapa of d.conversion.etapas) {
      agregar("conversion_etapa", etapa.nombre, etapa.alcanzadas);
      agregar("conversion_etapa_pct", etapa.nombre, etapa.pct);
    }
    for (const f of d.forecast) {
      agregar("forecast", `${f.mes}_total`, f.valor_total);
      agregar("forecast", `${f.mes}_ponderado`, f.valor_ponderado);
      agregar("forecast", `${f.mes}_oportunidades`, f.cantidad);
    }
    for (const [indicador, dato] of Object.entries(d.prospeccion)) {
      agregar("prospeccion", indicador, dato.valor, dato.mes_anterior);
    }
    for (const a of d.agentes) {
      agregar("agente", `${a.nombre} · actividades`, a.actividades);
      agregar("agente", `${a.nombre} · tareas_cerradas`, a.tareas_cerradas);
      agregar("agente", `${a.nombre} · vencidas`, a.vencidas);
      agregar("agente", `${a.nombre} · ganado`, a.ganado);
    }
    return { nombreArchivo: `informe-ejecutivo-${d.mes}.csv`, contenido: toCsv(filas, ["seccion", "indicador", "valor", "mes_anterior"]) };
  }

  async pdf(query: InformeEjecutivoQuery, user: CurrentUser) {
    const d = await this.datos(query);
    const doc = crearDocumentoCarta({
      titulo: "Informe ejecutivo",
      lineas: [
        `${mesLargo(d.mes)} · ${d.responsable ? d.responsable.nombre : "todos los responsables"}`,
        `Generado el ${fechaHoraMx(new Date())} por ${user.nombre}`
      ]
    });
    const anterior = mesCorto(d.mes_anterior);

    seccion(doc, "Resumen del mes");
    tarjetas(doc, [
      tarjetaPipeline(d, anterior),
      { etiqueta: "Ganado", valor: dineroCorto(d.resumen.ganado.valor), nota: `${d.resumen.cierres.valor} ${d.resumen.cierres.valor === 1 ? "cierre" : "cierres"}`, ...flecha(Number(d.resumen.ganado.valor), Number(d.resumen.ganado.mes_anterior)) },
      tarjetaTasa(d),
      { etiqueta: "Tareas vencidas", valor: numero(d.resumen.tareas_vencidas_hoy), nota: d.resumen.tareas_vencidas_hoy > 0 ? "revisar" : "al día", colorNota: d.resumen.tareas_vencidas_hoy > 0 ? COLOR.rojo : COLOR.verde }
    ]);

    franjaConversion(doc, d);

    // Conversión por etapa y forecast, lado a lado.
    const ancho = (anchoUtil(doc) - 19.5) / 2;
    const derecha = MARGEN.lados + ancho + 19.5;
    asegurarEspacio(doc, 150);
    const arriba = doc.y;
    seccion(doc, "Conversión por etapa", { ancho });
    barrasEtapas(doc, d.conversion.etapas, MARGEN.lados, doc.y, ancho, "Sin movimientos en el embudo este mes.");
    const finIzquierda = doc.y;
    doc.y = arriba;
    seccion(doc, "Forecast de cierre", { x: derecha, ancho });
    graficaForecast(doc, d.forecast, derecha, doc.y, ancho);
    doc.x = MARGEN.lados;
    doc.y = Math.max(finIzquierda, doc.y);

    seccion(doc, "Prospección");
    const p = d.prospeccion;
    tarjetas(doc, [
      { etiqueta: "Contactadas", valor: numero(p.contactadas.valor), ...diferencia(p.contactadas, anterior) },
      { etiqueta: "Respondieron", valor: numero(p.respondieron.valor), ...diferencia(p.respondieron) },
      { etiqueta: "Interesados", valor: numero(p.interesados.valor), ...diferencia(p.interesados) },
      // Más bajas no es bueno: la flecha va al revés de color.
      { etiqueta: "Bajas", valor: numero(p.bajas.valor), ...diferencia(p.bajas, undefined, true) }
    ]);
    if (d.responsable) {
      doc.font(FUENTE.normal).fontSize(7.5).fillColor(COLOR.pie)
        .text("La prospección es de todas las campañas: los correos no son de un agente.", MARGEN.lados, doc.y + 5, { width: anchoUtil(doc) });
    }

    seccion(doc, "Desempeño por agente");
    tabla(doc, {
      columnas: [
        { titulo: "Agente", ancho: 3 },
        { titulo: "Actividades", ancho: 2, alinear: "right" },
        { titulo: "Tareas cerradas", ancho: 2, alinear: "right" },
        { titulo: "Vencidas", ancho: 1.5, alinear: "right" },
        { titulo: "Ganado", ancho: 1.7, alinear: "right" }
      ],
      filas: d.agentes.map((a) => [
        { texto: a.nombre, negrita: true },
        numero(a.actividades),
        numero(a.tareas_cerradas),
        { texto: numero(a.vencidas), color: a.vencidas > 0 ? COLOR.rojo : undefined },
        { texto: dineroEntero(a.ganado), negrita: true }
      ]),
      vacio: "No hay agentes activos."
    });

    return { nombreArchivo: `informe-ejecutivo-${d.mes}.pdf`, contenido: await terminar(doc) };
  }
}

function flecha(valor: number, anterior: number | null): Pick<TarjetaDato, "flecha"> {
  if (anterior == null || valor === anterior) return {};
  return { flecha: valor > anterior ? "arriba" : "abajo" };
}

function tarjetaPipeline(d: DatosInforme, anterior: string): TarjetaDato {
  const { valor, mes_anterior } = d.resumen.pipeline_abierto;
  const base = { etiqueta: "Pipeline abierto", valor: valor == null ? "—" : dineroCorto(valor) };
  if (valor == null || mes_anterior == null || Number(mes_anterior) === 0) {
    return { ...base, nota: `${d.resumen.oportunidades_abiertas} abiertas` };
  }
  const cambio = ((Number(valor) - Number(mes_anterior)) / Number(mes_anterior)) * 100;
  return { ...base, nota: `${porcentaje(Math.abs(cambio))} vs ${anterior}`, ...flecha(Number(valor), Number(mes_anterior)) };
}

function tarjetaTasa(d: DatosInforme): TarjetaDato {
  const { valor, mes_anterior } = d.resumen.tasa_respuesta_pct;
  const base = { etiqueta: "Tasa de respuesta", valor: porcentaje(valor) };
  if (valor == null || mes_anterior == null) return { ...base, nota: valor == null ? "sin correos" : "" };
  const puntos = Number((valor - mes_anterior).toFixed(1));
  return puntos === 0 ? { ...base, nota: "igual" } : { ...base, nota: `${Math.abs(puntos)} pts`, ...flecha(valor, mes_anterior) };
}

function diferencia(dato: Comparado<number>, mesAnterior?: string, alReves = false): Pick<TarjetaDato, "nota" | "flecha" | "colorNota"> {
  const anterior = dato.mes_anterior ?? 0;
  const cambio = dato.valor - anterior;
  if (cambio === 0) return { nota: "igual" };
  const sentido = cambio > 0 ? "arriba" : "abajo";
  const bueno = alReves ? cambio < 0 : cambio > 0;
  return { nota: `${numero(Math.abs(cambio))}${mesAnterior ? ` vs ${mesAnterior}` : ""}`, flecha: sentido, colorNota: bueno ? COLOR.verde : COLOR.rojo };
}

// "23.4% Tasa de conversión. De las oportunidades calificadas, 1 de cada 4 se
// gana. Tiempo promedio para cerrar una oportunidad: 28 días."
function franjaConversion(doc: DocumentoPdf, d: DatosInforme) {
  const alto = 52;
  asegurarEspacio(doc, alto + 12);
  const y = doc.y + 10.5;
  const x = MARGEN.lados;
  const ancho = anchoUtil(doc);
  const fondo = doc.linearGradient(x, y, x + ancho, y + alto).stop(0, COLOR.azul, 0.08).stop(1, COLOR.morado, 0.08);
  doc.roundedRect(x, y, ancho, alto, 9).fill(fondo);

  const tasa = d.conversion.tasa_pct;
  doc.font(FUENTE.numeros).fontSize(22.5).fillColor(COLOR.azul).text(porcentaje(tasa), x + 12, y + 12, { width: 80, lineBreak: false });
  const unoDeCada = tasa != null && tasa > 0 ? Math.round(100 / tasa) : null;
  const frase = d.conversion.base_calificadas === 0
    ? "Todavía no hay oportunidades calificadas en el mes."
    : unoDeCada != null ? `De las oportunidades calificadas, 1 de cada ${unoDeCada} se gana.` : "De las oportunidades calificadas, ninguna se ha ganado todavía.";
  const ciclo = d.conversion.ciclo_medio_dias;
  const xTexto = x + 96;
  const opciones = { width: ancho - 96 - 12, lineGap: 2 };
  doc.font(FUENTE.extra).fontSize(9.4).fillColor(COLOR.tinta).text("Tasa de conversión. ", xTexto, y + 13, { ...opciones, continued: true });
  doc.font(FUENTE.normal).fillColor(COLOR.textoSuave).text(`${frase} Tiempo promedio para cerrar una oportunidad: `, { continued: true });
  doc.font(FUENTE.extra).fillColor(COLOR.tinta).text(ciclo == null ? "sin datos" : `${ciclo} días`, { continued: true });
  doc.font(FUENTE.normal).fillColor(COLOR.textoSuave).text(".");
  doc.x = MARGEN.lados;
  doc.y = y + alto;
}
