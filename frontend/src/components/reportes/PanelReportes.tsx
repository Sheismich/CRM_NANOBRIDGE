import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Avatar } from "../ui/Avatar";
import { BarrasConversion, ColumnasForecast, Dona, LineasProspeccion, Minigrafica } from "./GraficasReportes";
import { BotonCsv, TarjetaReporte } from "./piezas";
import { api } from "../../lib/api";
import { compacto, formatoMonedaEntera, plural } from "../../lib/formato";
import { isoDia } from "../../lib/inicio";
import { cambioPct, cambioPuntos, caidaMaxima, fraseConversion, fraseDesempeno, fraseForecast, fraseProspeccion, fraseTareas, nombreMesLargo, pct, type Cambio, type Rango } from "../../lib/reportes";
import { ETIQUETA_TIPO_TAREA } from "../../lib/tareas";
import type { ActividadesPorAgente, ConversionConCiclo, DesempenoAgente, ForecastMes, MetricaDiaria, PipelineResumen, ProspeccionDia, ReporteProspeccion, ReporteTareasPanel, Tarea } from "../../types";

// Reportes · panel completo (docs/diseno/reportes.html, opción A): cinco
// indicadores con su flecha contra el mismo tramo del periodo anterior, y
// las gráficas, cada una con una frase que la explica, dos datos al pie y
// su CSV. Solo administrador y supervisor (ReportesController).
//
// Lo que es foto del momento (pipeline abierto, tareas vencidas, forecast)
// no depende del periodo. La comparación y la línea del pipeline salen del
// histórico diario (metricas-diarias), que es de todo el equipo: con un
// responsable elegido no se muestran. La prospección tampoco se filtra por
// responsable: los correos los manda la automatización.

const COLOR_TIPO_TAREA: Record<Tarea["tipo"], string> = {
  seguimiento: "#2a449b",
  clasificacion: "#23bad3",
  revision_documento: "#5b2d86",
  otro: "#c57a0a"
};
const MESES_FORECAST = 5;

type Filtros = Rango & { responsableId?: number };

function useReporte<T>(ruta: string, params: Record<string, string | number | undefined>, enabled = true) {
  return useQuery({
    queryKey: ["reportes", ruta, params],
    queryFn: () => api.get<T>(`/api/v1/reportes/${ruta}`, params),
    enabled
  });
}

export function PanelReportes({ actual, anterior, contra, titulo, responsableId }: { actual: Rango; anterior: Rango; contra: string; titulo: string; responsableId?: number }) {
  const filtros: Filtros = { ...actual, responsableId };
  const filtrosAnterior: Filtros = { ...anterior, responsableId };
  const hoy = new Date();
  const primeroDelMes = isoDia(new Date(hoy.getFullYear(), hoy.getMonth(), 1));

  const resumen = useReporte<PipelineResumen>("pipeline/resumen", filtros);
  const resumenAnterior = useReporte<PipelineResumen>("pipeline/resumen", filtrosAnterior);
  const prospeccion = useReporte<ReporteProspeccion>("prospeccion", actual);
  const prospeccionAnterior = useReporte<ReporteProspeccion>("prospeccion", anterior);
  const actividades = useReporte<ActividadesPorAgente>("actividades", filtros);
  const actividadesAnterior = useReporte<ActividadesPorAgente>("actividades", filtrosAnterior);
  const tareas = useReporte<ReporteTareasPanel>("tareas", filtros);
  const conversion = useReporte<ConversionConCiclo>("pipeline/conversion-etapas", filtros);
  const forecast = useReporte<ForecastMes[]>("forecast", { fechaInicio: primeroDelMes, responsableId });
  const porDia = useReporte<ProspeccionDia[]>("prospeccion/por-dia", actual);
  const desempeno = useReporte<DesempenoAgente[]>("desempeno-por-agente", filtros);
  const metricas = useReporte<MetricaDiaria[]>("metricas-diarias", { fechaInicio: anterior.fechaInicio, fechaFin: actual.fechaFin }, !responsableId);

  // --- Indicadores ---
  const pipeline = resumen.data ? Number(resumen.data.abiertas.valor_pipeline) : null;
  const historico = responsableId ? [] : (metricas.data ?? []);
  const pipelineAntes = [...historico].reverse().find((m) => m.fecha <= anterior.fechaFin);
  const enPeriodo = historico.filter((m) => m.fecha >= actual.fechaInicio);
  const ganado = resumen.data ? Number(resumen.data.ganadas.ingresos_cerrados) : null;
  const ganadoAcumulado = enPeriodo.reduce<number[]>((serie, m) => [...serie, (serie[serie.length - 1] ?? 0) + Number(m.ingresos_cerrados)], []);
  const totalActividades = (a: ActividadesPorAgente | undefined) => a?.reduce((s, f) => s + f.total, 0);
  const vencidas = tareas.data?.vencidas.total;

  const ganadas = resumen.data?.ganadas.cantidad ?? 0;
  const cambioTasa = prospeccion.data ? cambioPuntos(prospeccion.data.tasa_respuesta_pct, prospeccionAnterior.data?.tasa_respuesta_pct, contra) : null;
  const cambioGanado = ganado != null && resumenAnterior.data ? cambioPct(ganado, Number(resumenAnterior.data.ganadas.ingresos_cerrados), contra) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2.5 md:gap-3 xl:grid-cols-5">
        <Indicador
          etiqueta="Pipeline abierto"
          valor={pipeline == null ? "…" : compacto.format(pipeline)}
          cambio={pipeline != null && pipelineAntes ? cambioPct(pipeline, Number(pipelineAntes.valor_pipeline), contra) : null}
          sinCambio={responsableId ? "oportunidades abiertas hoy" : "abiertas hoy"}
          linea={pipeline != null && enPeriodo.length > 0 ? { valores: [...enPeriodo.map((m) => Number(m.valor_pipeline)), pipeline], color: "#2a449b" } : undefined}
          className="col-span-2 xl:col-span-1"
        />
        <Indicador
          etiqueta="Ganado"
          valor={ganado == null ? "…" : compacto.format(ganado)}
          cambio={cambioGanado && { ...cambioGanado, texto: `${cambioGanado.texto} · ${plural(ganadas, "cierre", "cierres")}` }}
          sinCambio={plural(ganadas, "cierre", "cierres")}
          linea={ganadoAcumulado.length > 1 ? { valores: ganadoAcumulado, color: "#15905f" } : undefined}
        />
        <Indicador
          etiqueta="Tasa de respuesta"
          valor={prospeccion.data ? pct(prospeccion.data.tasa_respuesta_pct) : "…"}
          cambio={cambioTasa}
          sinCambio={prospeccion.data ? plural(prospeccion.data.envios.personas_contactadas, "persona contactada", "personas contactadas") : ""}
          linea={porDia.data && porDia.data.length > 1 ? { valores: porDia.data.map((d) => d.respuestas), color: "#23bad3" } : undefined}
        />
        <Indicador
          etiqueta="Actividades"
          valor={actividades.data ? String(totalActividades(actividades.data)) : "…"}
          cambio={actividades.data && actividadesAnterior.data ? cambioPct(totalActividades(actividades.data)!, totalActividades(actividadesAnterior.data), contra) : null}
          sinCambio="llamadas, WhatsApp y comentarios"
        />
        <Indicador
          etiqueta="Tareas vencidas"
          valor={vencidas == null ? "…" : String(vencidas)}
          tonoValor={vencidas ? "danger" : undefined}
          cambio={vencidas == null ? null : vencidas > 0 ? { texto: "revisar", tono: "danger" } : { texto: "al día", tono: "ok" }}
          sinCambio=""
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TarjetaReporte
          titulo="Conversión por etapa"
          subtitulo="de calificada a ganada"
          extra={<BotonCsv reporte="conversion-etapas" filtros={filtros} />}
          frase={conversion.data && fraseConversion(conversion.data)}
          pie={
            conversion.data && (
              <>
                Ciclo medio de venta: <b className="text-strong">{conversion.data.ciclo_medio_venta.dias == null ? "—" : `${Math.round(conversion.data.ciclo_medio_venta.dias)} días`}</b>
              </>
            )
          }
          pieDerecha={conversion.data && caidaMaxima(conversion.data) && <span className="text-warn">Donde más se caen: {caidaMaxima(conversion.data)}</span>}
        >
          <Estado consulta={conversion}>{conversion.data && <BarrasConversion etapas={conversion.data.etapas} />}</Estado>
        </TarjetaReporte>

        <TarjetaReporte
          titulo="Forecast"
          subtitulo="cierre esperado por mes"
          extra={<BotonCsv reporte="forecast" filtros={{ fechaInicio: primeroDelMes, responsableId }} />}
          frase={forecast.data && fraseForecast(forecast.data.slice(0, MESES_FORECAST), nombreMesLargo)}
          pie={
            forecast.data && (
              <>
                Ponderado de {forecast.data.length > 1 ? `los próximos ${Math.min(forecast.data.length, MESES_FORECAST)} meses` : "lo que viene"}:{" "}
                <b className="text-strong">{formatoMonedaEntera.format(forecast.data.slice(0, MESES_FORECAST).reduce((s, m) => s + Number(m.valor_ponderado), 0))}</b>
              </>
            )
          }
          pieDerecha={resumen.data && resumen.data.cierre_vencido.cantidad > 0 && <span className="text-warn">{plural(resumen.data.cierre_vencido.cantidad, "oportunidad", "oportunidades")} con cierre vencido</span>}
        >
          <Estado consulta={forecast} vacio={forecast.data?.length === 0}>
            {forecast.data && <ColumnasForecast meses={forecast.data.slice(0, MESES_FORECAST)} />}
          </Estado>
        </TarjetaReporte>

        <TarjetaReporte
          titulo="Prospección"
          subtitulo="correos y respuestas por día"
          extra={<BotonCsv reporte="prospeccion" filtros={actual} />}
          frase={porDia.data && fraseProspeccion(porDia.data)}
          pie={responsableId ? <span className="text-ink-3">No se filtra por responsable: los correos los manda la automatización.</span> : undefined}
          pieDerecha={
            prospeccion.data && (
              <span className="text-ok">
                Tasa de respuesta {pct(prospeccion.data.tasa_respuesta_pct)}
                {cambioTasa ? ` (${cambioTasa.texto})` : ""}
              </span>
            )
          }
        >
          <Estado consulta={porDia}>{porDia.data && <LineasProspeccion dias={porDia.data} />}</Estado>
        </TarjetaReporte>

        <TarjetaReporte
          titulo="Tareas por tipo"
          subtitulo={`creadas en ${titulo}`}
          extra={<BotonCsv reporte="tareas" filtros={filtros} />}
          frase={tareas.data && fraseTareas(tareas.data)}
          pie={
            tareas.data && (
              <>
                Se cierran a tiempo: <b className="text-strong">{pct(tareas.data.a_tiempo.pct)}</b>
              </>
            )
          }
          pieDerecha={tareas.data && <span className="text-ok">{plural(tareas.data.cerradas_esta_semana, "tarea resuelta", "tareas resueltas")} esta semana</span>}
        >
          <Estado consulta={tareas}>
            {tareas.data && (
              <Dona
                centro={tareas.data.creadas.total}
                partes={tareas.data.creadas.por_tipo.map((t) => ({ etiqueta: ETIQUETA_TIPO_TAREA[t.tipo], valor: t.cantidad, color: COLOR_TIPO_TAREA[t.tipo] }))}
              />
            )}
          </Estado>
        </TarjetaReporte>
      </div>

      <TarjetaReporte titulo="Desempeño por agente" subtitulo={titulo} extra={<BotonCsv reporte="desempeno-por-agente" filtros={filtros} />} frase={desempeno.data && fraseDesempeno(desempeno.data)}>
        <Estado consulta={desempeno} vacio={desempeno.data?.length === 0}>
          {desempeno.data && <TablaDesempeno filas={desempeno.data} />}
        </Estado>
      </TarjetaReporte>
    </div>
  );
}

function Indicador({
  etiqueta,
  valor,
  cambio,
  sinCambio,
  linea,
  tonoValor,
  className
}: {
  etiqueta: string;
  valor: string;
  cambio: Cambio | null;
  sinCambio: string;
  linea?: { valores: number[]; color: string };
  tonoValor?: "danger";
  className?: string;
}) {
  return (
    <div className={clsx("tarjeta-blanca min-w-0 !rounded-[16px] px-4 pb-3 pt-3.5", className)}>
      <small className="block font-heading text-[10.5px] font-extrabold uppercase leading-snug tracking-[0.8px] text-ink-3 md:text-[11px] md:tracking-[1.2px]">{etiqueta}</small>
      <b className={clsx("mono mt-1 block font-display text-[30px] font-normal leading-tight", tonoValor === "danger" ? "text-danger" : "text-strong")}>{valor}</b>
      <span className={clsx("block text-[12px] font-bold", !cambio ? "font-medium text-ink-3" : cambio.tono === "ok" ? "text-ok" : cambio.tono === "danger" ? "text-danger" : "text-ink-3")}>
        {cambio?.texto ?? (sinCambio || " ")}
      </span>
      {linea && <Minigrafica valores={linea.valores} color={linea.color} />}
    </div>
  );
}

function Estado({ consulta, vacio, children }: { consulta: { isPending: boolean; isError: boolean }; vacio?: boolean; children: ReactNode }) {
  if (consulta.isPending) return <div className="py-6 text-sm text-ink-2">Cargando…</div>;
  if (consulta.isError) return <div className="py-6 text-sm text-danger">No se pudo cargar este reporte.</div>;
  if (vacio) return <div className="py-6 text-sm text-ink-3">Sin datos para mostrar.</div>;
  return <>{children}</>;
}

function TablaDesempeno({ filas }: { filas: DesempenoAgente[] }) {
  const ordenadas = [...filas].sort((a, b) => b.actividades.total - a.actividades.total);
  return (
    // tabIndex: en el celular la tabla se desliza de lado, y así también con las flechas del teclado.
    <div className="-mx-4 overflow-x-auto md:-mx-[18px]" tabIndex={0} role="region" aria-label="Desempeño por agente">
      <table className="w-full min-w-[520px] border-collapse text-[13px]">
        <thead>
          <tr className="font-heading text-[10px] font-extrabold uppercase tracking-[1px] text-ink-3">
            <th className="px-4 py-2.5 text-left md:px-[18px]">Agente</th>
            <th className="px-3 py-2.5 text-right">Actividades</th>
            <th className="px-3 py-2.5 text-right">Tareas cerradas</th>
            <th className="px-3 py-2.5 text-right">Vencidas</th>
            <th className="px-4 py-2.5 text-right md:px-[18px]">Ganado</th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f) => (
            <tr key={f.responsable_id} className="border-t border-border">
              <td className="px-4 py-3 md:px-[18px]">
                <span className="flex items-center gap-2.5 font-semibold text-strong">
                  <Avatar nombre={f.responsable_nombre} />
                  {f.responsable_nombre}
                </span>
              </td>
              <td className="mono px-3 py-3 text-right">{f.actividades.total}</td>
              <td className="mono px-3 py-3 text-right">{f.tareas.cerradas}</td>
              <td className={clsx("mono px-3 py-3 text-right", f.tareas.vencidas > 0 && "font-bold text-danger")}>{f.tareas.vencidas}</td>
              <td className="mono px-4 py-3 text-right font-bold text-strong md:px-[18px]">{formatoMonedaEntera.format(Number(f.oportunidades.ingresos_cerrados))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
