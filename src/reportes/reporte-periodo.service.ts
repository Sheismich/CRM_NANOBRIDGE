import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { usuarios } from "../database/schema.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { fechaMx } from "../shared/dia-habil.js";
import { COLOR, FUENTE, MARGEN, anchoUtil, asegurarEspacio, crearDocumentoCarta, seccion, tabla, tarjetas, terminar, type DocumentoPdf, type TarjetaDato } from "../shared/pdf/molde.js";
import { dineroCorto, dineroEntero, fechaHoraMx, numero } from "../shared/pdf/formato.js";
import { ReportesService } from "./reportes.service.js";
import { barrasEtapas, graficaForecast } from "./pdf-graficas.js";
import { ETIQUETA_TIPO_TAREA, caidaMaxima, cambioPct, cambioPuntos, fraseConversion, fraseDesempeno, fraseForecast, fraseProspeccion, fraseTareas, pct, plural, rangoLegible, rangosDelPeriodo, type Cambio, type PeriodoReporte } from "./frases.js";
import type { ReportePeriodoQuery } from "./dto/reporte.schema.js";

// Reporte del periodo (16-oct-2026): el PDF del botón "Exportar" de
// Reportes. Antes ese botón bajaba el informe ejecutivo del mes, el mismo
// que el de Oportunidades. Ahora es lo que se ve en el panel: el periodo
// elegido (semana, mes, trimestre o año hasta hoy) contra el mismo tramo
// del periodo anterior, con el responsable elegido, las mismas frases que
// explican cada gráfica (./frases.ts) y los mismos reportes de
// ReportesService que pide la pantalla. El informe ejecutivo se queda
// como está: un mes completo, para el jefe.
//
// Como en la pantalla: el pipeline abierto, el forecast y las tareas
// vencidas son foto de hoy; la comparación del pipeline sale del job diario
// de métricas, que es de todo el equipo (con responsable no hay contra qué
// comparar), y la prospección no se filtra por responsable.

const MESES_FORECAST = 5;

const NOMBRE_PERIODO: Record<PeriodoReporte, (titulo: string) => string> = {
  semana: () => "Esta semana",
  mes: (titulo) => `${titulo[0]!.toUpperCase()}${titulo.slice(1)}`,
  trimestre: (titulo) => `Trimestre ${titulo}`,
  anio: (titulo) => `Año ${titulo}`
};

function primeroDelMes(dia: string) {
  return `${dia.slice(0, 7)}-01`;
}

function sumarMeses(mes: string, meses: number) {
  const [anio, numeroMes] = mes.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(anio, numeroMes - 1 + meses, 1)).toISOString().slice(0, 7);
}

@Injectable()
export class ReportePeriodoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly reportesService: ReportesService
  ) {}

  async datos(query: ReportePeriodoQuery) {
    const hoy = fechaMx(new Date());
    const rangos = rangosDelPeriodo(query.periodo, hoy);
    const { actual, anterior } = rangos;
    const filtros = { ...actual, responsableId: query.responsableId };
    const filtrosAnterior = { ...anterior, responsableId: query.responsableId };

    const [resumen, resumenAnterior, prospeccion, prospeccionAnterior, actividades, actividadesAnterior, tareas, conversion, forecast, porDia, desempeno, metricas, responsable] = await Promise.all([
      this.reportesService.pipelineResumen(filtros),
      this.reportesService.pipelineResumen(filtrosAnterior),
      this.reportesService.prospeccion(actual),
      this.reportesService.prospeccion(anterior),
      this.reportesService.actividadesPorAgente(filtros),
      this.reportesService.actividadesPorAgente(filtrosAnterior),
      this.reportesService.tareasReporte(filtros),
      this.reportesService.conversionEtapas(filtros),
      this.reportesService.forecastMensual({ fechaInicio: primeroDelMes(hoy), responsableId: query.responsableId }),
      this.reportesService.prospeccionPorDia(actual),
      this.reportesService.desempenoPorAgente(filtros),
      query.responsableId ? Promise.resolve([]) : this.reportesService.historicoMetricasDiarias({ fechaInicio: anterior.fechaInicio, fechaFin: actual.fechaFin }),
      query.responsableId ? this.nombreDe(query.responsableId) : Promise.resolve(null)
    ]);

    // El histórico viene del más nuevo al más viejo: la foto del pipeline al
    // cierre del tramo anterior es la primera que no pasa de su último día.
    const pipelineAntes = metricas.find((m) => m.fecha <= anterior.fechaFin);
    const total = (a: { total: number }[]) => a.reduce((s, f) => s + f.total, 0);
    const proximos = forecast.slice(0, MESES_FORECAST);
    const porMes = new Map(proximos.map((f) => [f.mes, f]));

    return {
      periodo: query.periodo,
      hoy,
      ...rangos,
      responsable: query.responsableId ? { id: query.responsableId, nombre: responsable ?? `#${query.responsableId}` } : null,
      resumen,
      pipelineAntes: pipelineAntes ? pipelineAntes.valor_pipeline : null,
      ganadoAnterior: resumenAnterior.ganadas.ingresos_cerrados,
      prospeccion,
      prospeccionAnterior,
      actividades: total(actividades),
      actividadesAnterior: total(actividadesAnterior),
      tareas,
      conversion,
      forecast: proximos,
      // La gráfica siempre enseña los 5 meses, aunque alguno no tenga nada.
      forecastGrafica: Array.from({ length: MESES_FORECAST }, (_, i) => {
        const mes = sumarMeses(hoy.slice(0, 7), i);
        const fila = porMes.get(mes);
        return { mes, valor_total: fila?.valor_estimado_total ?? "0.00", valor_ponderado: fila?.valor_ponderado ?? "0.00" };
      }),
      porDia,
      desempeno
    };
  }

  private async nombreDe(usuarioId: number) {
    const [fila] = await this.db.select({ nombre: usuarios.nombre }).from(usuarios).where(eq(usuarios.id, usuarioId)).limit(1);
    return fila?.nombre ?? null;
  }

  async pdf(query: ReportePeriodoQuery, user: CurrentUser) {
    const d = await this.datos(query);
    const doc = crearDocumentoCarta({
      titulo: "Reporte del periodo",
      lineas: [
        `${NOMBRE_PERIODO[d.periodo](d.titulo)} · ${rangoLegible(d.actual)} · contra ${d.contra} (${rangoLegible(d.anterior)})`,
        d.responsable ? `Responsable: ${d.responsable.nombre}` : "Todos los responsables",
        `Generado el ${fechaHoraMx(new Date())} por ${user.nombre}`
      ]
    });
    const corto = d.contraCorto;

    // --- Indicadores (los cinco de arriba del panel) ---
    const pipeline = Number(d.resumen.abiertas.valor_pipeline);
    const ganado = Number(d.resumen.ganadas.ingresos_cerrados);
    const cierres = d.resumen.ganadas.cantidad;
    const tasa = d.prospeccion.tasa_respuesta_pct;
    const vencidas = d.tareas.vencidas.total;
    seccion(doc, "Indicadores");
    tarjetas(doc, [
      tarjeta("Pipeline abierto", dineroCorto(pipeline), d.pipelineAntes == null ? null : cambioPct(pipeline, Number(d.pipelineAntes), corto), `${d.resumen.abiertas.cantidad} abiertas hoy`),
      tarjeta("Ganado", dineroCorto(ganado), cambioPct(ganado, Number(d.ganadoAnterior), corto), plural(cierres, "cierre", "cierres")),
      tarjeta("Tasa de respuesta", pct(tasa), cambioPuntos(tasa, d.prospeccionAnterior.tasa_respuesta_pct, corto), `${d.prospeccion.envios.personas_contactadas} contactadas`),
      tarjeta("Actividades", numero(d.actividades), cambioPct(d.actividades, d.actividadesAnterior, corto), "registradas"),
      { etiqueta: "Tareas vencidas", valor: numero(vencidas), nota: vencidas > 0 ? "revisar" : "al día", colorNota: vencidas > 0 ? COLOR.rojo : COLOR.verde }
    ]);
    if (d.responsable) {
      nota(doc, "Con responsable elegido, el pipeline no se compara (el histórico diario es de todo el equipo) y la prospección es de todas las campañas.");
    }

    // --- Conversión y forecast, lado a lado ---
    const ancho = (anchoUtil(doc) - 19.5) / 2;
    const derecha = MARGEN.lados + ancho + 19.5;
    asegurarEspacio(doc, 190);
    const arriba = doc.y;
    seccion(doc, "Conversión por etapa", { ancho });
    frase(doc, fraseConversion(d.conversion), MARGEN.lados, ancho);
    // Sin calificadas la frase ya lo dice: no se repite con las barras vacías.
    if (d.conversion.base_calificadas > 0) barrasEtapas(
      doc,
      d.conversion.etapas.map((e) => ({ clave: e.etapa_clave, nombre: e.etapa_nombre, alcanzadas: e.oportunidades_alcanzadas, pct: e.conversion_desde_calificada_pct })),
      MARGEN.lados,
      doc.y,
      ancho,
      "Sin movimientos en el embudo en este periodo."
    );
    const ciclo = d.conversion.ciclo_medio_venta.dias;
    const caida = caidaMaxima(d.conversion);
    pie(doc, [`Ciclo medio de venta: ${ciclo == null ? "—" : `${Math.round(ciclo)} días`}`, caida ? `Donde más se caen: ${caida}` : null], MARGEN.lados, ancho);
    const finIzquierda = doc.y;

    doc.y = arriba;
    seccion(doc, "Forecast de cierre", { x: derecha, ancho });
    frase(doc, fraseForecast(d.forecast), derecha, ancho);
    graficaForecast(doc, d.forecastGrafica, derecha, doc.y, ancho);
    const ponderado = d.forecast.reduce((s, m) => s + Number(m.valor_ponderado), 0);
    const vencido = d.resumen.cierre_vencido.cantidad;
    pie(doc, [`Ponderado de los próximos ${MESES_FORECAST} meses: ${dineroEntero(ponderado)}`, vencido > 0 ? `${plural(vencido, "oportunidad", "oportunidades")} con cierre vencido` : null], derecha, ancho);
    doc.x = MARGEN.lados;
    doc.y = Math.max(finIzquierda, doc.y);

    // --- Prospección ---
    const envios = d.porDia.reduce((s, x) => s + x.envios, 0);
    const respuestas = d.porDia.reduce((s, x) => s + x.respuestas, 0);
    seccion(doc, "Prospección");
    frase(doc, fraseProspeccion(d.porDia), MARGEN.lados, anchoUtil(doc));
    tarjetas(doc, [
      { etiqueta: "Correos enviados", valor: numero(envios) },
      { etiqueta: "Respuestas", valor: numero(respuestas) },
      { etiqueta: "Personas contactadas", valor: numero(d.prospeccion.envios.personas_contactadas) },
      tarjeta("Tasa de respuesta", pct(tasa), cambioPuntos(tasa, d.prospeccionAnterior.tasa_respuesta_pct, corto), "")
    ]);
    if (d.responsable) nota(doc, "No se filtra por responsable: los correos los manda la automatización.");

    // --- Tareas por tipo ---
    seccion(doc, "Tareas por tipo");
    frase(doc, fraseTareas(d.tareas), MARGEN.lados, anchoUtil(doc));
    if (d.tareas.creadas.por_tipo.length > 0) tabla(doc, {
      columnas: [
        { titulo: "Tipo", ancho: 4 },
        { titulo: "Creadas en el periodo", ancho: 2, alinear: "right" }
      ],
      filas: d.tareas.creadas.por_tipo.map((t) => [{ texto: ETIQUETA_TIPO_TAREA[t.tipo] ?? t.tipo, negrita: true }, numero(t.cantidad)]),
      vacio: "No se crearon tareas en este periodo."
    });
    pie(doc, [`Se cierran a tiempo: ${pct(d.tareas.a_tiempo.pct)}`, `${plural(d.tareas.cerradas_esta_semana, "tarea resuelta", "tareas resueltas")} esta semana`], MARGEN.lados, anchoUtil(doc));

    // --- Desempeño por agente ---
    seccion(doc, "Desempeño por agente");
    frase(doc, fraseDesempeno(d.desempeno), MARGEN.lados, anchoUtil(doc));
    if (d.desempeno.length > 0) tabla(doc, {
      columnas: [
        { titulo: "Agente", ancho: 3 },
        { titulo: "Actividades", ancho: 2, alinear: "right" },
        { titulo: "Tareas cerradas", ancho: 2, alinear: "right" },
        { titulo: "Vencidas", ancho: 1.5, alinear: "right" },
        { titulo: "Ganado", ancho: 1.7, alinear: "right" }
      ],
      filas: [...d.desempeno].sort((a, b) => b.actividades.total - a.actividades.total).map((a) => [
        { texto: a.responsable_nombre, negrita: true },
        numero(a.actividades.total),
        numero(a.tareas.cerradas),
        { texto: numero(a.tareas.vencidas), color: a.tareas.vencidas > 0 ? COLOR.rojo : undefined },
        { texto: dineroEntero(a.oportunidades.ingresos_cerrados), negrita: true }
      ]),
      vacio: "No hay agentes activos."
    });

    return { nombreArchivo: `reporte-${d.periodo}-${d.hoy}.pdf`, contenido: await terminar(doc) };
  }
}

// Tarjeta con su comparación; sin comparación, el dato de apoyo en gris.
function tarjeta(etiqueta: string, valor: string, cambio: Cambio | null, sinCambio: string): TarjetaDato {
  if (!cambio) return { etiqueta, valor, nota: sinCambio };
  return {
    etiqueta,
    valor,
    nota: cambio.texto,
    ...(cambio.sentido ? { flecha: cambio.sentido } : {}),
    colorNota: cambio.bueno == null ? COLOR.gris : cambio.bueno ? COLOR.verde : COLOR.rojo
  };
}

// La frase que explica la sección, arriba de su gráfica o tabla.
function frase(doc: DocumentoPdf, texto: string, x: number, ancho: number) {
  doc.font(FUENTE.normal).fontSize(8.8).fillColor(COLOR.textoSuave).text(texto, x, doc.y, { width: ancho, lineGap: 1.5 });
  doc.y += 6;
}

// Dos datos al pie, separados por un punto medio.
function pie(doc: DocumentoPdf, partes: (string | null)[], x: number, ancho: number) {
  const texto = partes.filter(Boolean).join("  ·  ");
  if (!texto) return;
  doc.font(FUENTE.semi).fontSize(8).fillColor(COLOR.gris).text(texto, x, doc.y + 6, { width: ancho });
}

function nota(doc: DocumentoPdf, texto: string) {
  doc.font(FUENTE.normal).fontSize(7.5).fillColor(COLOR.pie).text(texto, MARGEN.lados, doc.y + 5, { width: anchoUtil(doc) });
}
