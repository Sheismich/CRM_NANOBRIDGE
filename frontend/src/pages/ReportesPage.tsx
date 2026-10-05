import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Button } from "../components/ui/Button";
import { Card, SectionTitle } from "../components/ui/Card";
import { ServerError, inputBaseClass } from "../components/ui/Field";
import { GraficaConversion, GraficaForecast } from "../components/reportes/Graficas";
import { ApiError, api } from "../lib/api";
import { useCampanas } from "../lib/campanas";
import { ETIQUETA_CLASIFICACION, ETIQUETA_TIPO_TAREA } from "../lib/tareas";
import { etiquetaMes, fechaLocal, formatoFecha, formatoFechaHora, formatoMonedaEntera, plural } from "../lib/formato";
import type { Clasificacion, ConversionEtapas, DesempenoAgente, ForecastMes, MetricaDiaria, Paginated, PipelineResumen, ReporteProspeccion, ReporteTareas, Usuario } from "../types";

// Reportes (PLAN_FRONTEND.md §5, punto #5 del jefe). Solo administrador y
// supervisor: ReportesController lo exige y App.tsx protege la ruta.

// --- Filtros -----------------------------------------------------------------

type Periodo = "mes" | "mes_anterior" | "90_dias" | "anio" | "todo" | "personalizado";
const PERIODOS: { id: Periodo; label: string }[] = [
  { id: "mes", label: "Este mes" },
  { id: "mes_anterior", label: "Mes anterior" },
  { id: "90_dias", label: "Últimos 90 días" },
  { id: "anio", label: "Este año" },
  { id: "todo", label: "Todo el historial" },
  { id: "personalizado", label: "Personalizado" }
];

// "YYYY-MM-DD" con la fecha LOCAL (toISOString la pasaría a UTC y de noche
// en México daría el día siguiente).
function isoLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function rangoDe(periodo: Exclude<Periodo, "personalizado">): { fechaInicio?: string; fechaFin?: string } {
  const hoy = new Date();
  const [a, m] = [hoy.getFullYear(), hoy.getMonth()];
  switch (periodo) {
    case "mes":
      return { fechaInicio: isoLocal(new Date(a, m, 1)), fechaFin: isoLocal(hoy) };
    case "mes_anterior":
      return { fechaInicio: isoLocal(new Date(a, m - 1, 1)), fechaFin: isoLocal(new Date(a, m, 0)) };
    case "90_dias":
      return { fechaInicio: isoLocal(new Date(a, m, hoy.getDate() - 89)), fechaFin: isoLocal(hoy) };
    case "anio":
      return { fechaInicio: isoLocal(new Date(a, 0, 1)), fechaFin: isoLocal(hoy) };
    case "todo":
      return {};
  }
}

type Filtros = { fechaInicio?: string; fechaFin?: string; responsableId?: number; campanaId?: number };

// Mismo nombre de archivo que ReportesService.exportarCsv (el header
// Content-Disposition no se puede leer desde fetch sin exponerlo en CORS).
const ARCHIVO_EXPORTACION = {
  actividades: "actividades_por_agente.csv",
  tareas: "tareas_cerradas_vencidas.csv",
  "conversion-etapas": "conversion_por_etapa.csv",
  pipeline: "pipeline_resumen.csv",
  forecast: "forecast_mensual.csv",
  "desempeno-por-agente": "desempeno_por_agente.csv",
  prospeccion: "prospeccion_por_campana.csv"
} as const;
type ReporteExportable = keyof typeof ARCHIVO_EXPORTACION;

export function ReportesPage() {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [personalizado, setPersonalizado] = useState<{ fechaInicio: string; fechaFin: string }>(() => {
    const r = rangoDe("mes");
    return { fechaInicio: r.fechaInicio!, fechaFin: r.fechaFin! };
  });
  const [responsableId, setResponsableId] = useState<number | undefined>(undefined);

  const rango = periodo === "personalizado" ? { fechaInicio: personalizado.fechaInicio || undefined, fechaFin: personalizado.fechaFin || undefined } : rangoDe(periodo);
  const rangoInvalido = Boolean(rango.fechaInicio && rango.fechaFin && rango.fechaInicio > rango.fechaFin);
  const filtros: Filtros = { ...rango, responsableId };

  // Para el selector de agente: GET /usuarios lo permite a admin/supervisor.
  const { data: agentes } = useQuery({
    queryKey: ["usuarios", "agentes-activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { rol: "agente", activo: true, limit: 100 }),
    staleTime: 5 * 60_000
  });

  return (
    <AppShell titulo="Reportes">
      <div className="flex flex-col gap-5">
        <Card className="flex flex-wrap items-end gap-3 px-5 py-4">
          <Filtro etiqueta="Periodo">
            <select aria-label="Periodo" className={`${inputBaseClass} w-auto`} value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
              {PERIODOS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </Filtro>
          {periodo === "personalizado" && (
            <>
              <Filtro etiqueta="Desde">
                <input type="date" aria-label="Desde" className={`${inputBaseClass} w-auto`} value={personalizado.fechaInicio} onChange={(e) => setPersonalizado((p) => ({ ...p, fechaInicio: e.target.value }))} />
              </Filtro>
              <Filtro etiqueta="Hasta">
                <input type="date" aria-label="Hasta" className={`${inputBaseClass} w-auto`} value={personalizado.fechaFin} onChange={(e) => setPersonalizado((p) => ({ ...p, fechaFin: e.target.value }))} />
              </Filtro>
            </>
          )}
          <Filtro etiqueta="Agente">
            <select aria-label="Agente" className={`${inputBaseClass} w-auto`} value={responsableId ?? ""} onChange={(e) => setResponsableId(e.target.value ? Number(e.target.value) : undefined)}>
              <option value="">Todos</option>
              {agentes?.data.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          </Filtro>
          <div className="pb-2 text-xs text-ink-3">
            {periodo !== "personalizado" && rango.fechaInicio && rango.fechaFin && `${formatoFecha.format(fechaLocal(rango.fechaInicio))} – ${formatoFecha.format(fechaLocal(rango.fechaFin))}`}
          </div>
        </Card>

        {rangoInvalido ? (
          <ServerError message="La fecha inicial debe ser anterior o igual a la final." />
        ) : (
          <>
            <Indicadores filtros={filtros} />
            <DesempenoPorAgente filtros={filtros} />
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Conversion filtros={filtros} />
              <Forecast responsableId={responsableId} />
            </div>
            <TareasPorTipo filtros={filtros} />
            <Prospeccion rango={rango} filtradoPorAgente={responsableId !== undefined} />
            <MetricasDiarias fechaInicio={rango.fechaInicio} fechaFin={rango.fechaFin} filtradoPorAgente={responsableId !== undefined} />
          </>
        )}
      </div>
    </AppShell>
  );
}

function Filtro({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-2">{etiqueta}</span>
      {children}
    </div>
  );
}

function useReporte<T>(ruta: string, filtros: Filtros) {
  return useQuery({
    queryKey: ["reportes", ruta, filtros],
    queryFn: () => api.get<T>(`/api/v1/reportes/${ruta}`, filtros)
  });
}

// El CSV sale de GET /reportes/export/:reporte con los mismos filtros; se
// pide con fetch (lleva la cookie de sesión) y se descarga como Blob.
function BotonExportar({ reporte, filtros }: { reporte: ReporteExportable; filtros: Filtros }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState(false);

  async function exportar() {
    setOcupado(true);
    setError(false);
    try {
      const csv = await api.get<string>(`/api/v1/reportes/export/${reporte}`, filtros);
      // BOM: sin él Excel abre el CSV como ANSI y rompe los acentos.
      const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = ARCHIVO_EXPORTACION[reporte];
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(true);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Button variant="ghost" className="border border-border px-3 py-1.5 text-xs" disabled={ocupado} onClick={exportar} title={error ? "No se pudo exportar; intenta de nuevo" : undefined}>
      {error ? "Reintentar CSV" : "Exportar CSV"}
    </Button>
  );
}

function Encabezado({ titulo, nota, children }: { titulo: string; nota?: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <SectionTitle>{titulo}</SectionTitle>
        {nota && <div className="-mt-2.5 text-xs text-ink-3">{nota}</div>}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </div>
  );
}

function Estado({ isPending, isError }: { isPending: boolean; isError: boolean }) {
  if (isPending) return <div className="text-sm text-ink-2">Cargando…</div>;
  if (isError) return <div className="text-sm text-danger">No se pudo cargar este reporte.</div>;
  return null;
}

// --- Indicadores ---------------------------------------------------------------

function Indicadores({ filtros }: { filtros: Filtros }) {
  const pipeline = useReporte<PipelineResumen>("pipeline/resumen", filtros);
  const tareas = useReporte<ReporteTareas>("tareas", filtros);

  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Indicador etiqueta="Pipeline abierto (hoy)" cargando={pipeline.isPending} valor={pipeline.data && formatoMonedaEntera.format(Number(pipeline.data.abiertas.valor_pipeline))} sub={pipeline.data && plural(pipeline.data.abiertas.cantidad, "oportunidad abierta", "oportunidades abiertas")} />
      <Indicador etiqueta="Ingresos cerrados" cargando={pipeline.isPending} valor={pipeline.data && formatoMonedaEntera.format(Number(pipeline.data.ganadas.ingresos_cerrados))} sub={pipeline.data && `${plural(pipeline.data.ganadas.cantidad, "ganada", "ganadas")} en el periodo`} tono="ok" />
      <Indicador etiqueta="Perdido" cargando={pipeline.isPending} valor={pipeline.data && formatoMonedaEntera.format(Number(pipeline.data.perdidas.valor_perdido))} sub={pipeline.data && `${plural(pipeline.data.perdidas.cantidad, "perdida", "perdidas")} en el periodo`} tono="danger" />
      <Indicador etiqueta="Tareas cerradas" cargando={tareas.isPending} valor={tareas.data && String(tareas.data.cerradas.total)} sub={tareas.data && `${plural(tareas.data.vencidas.total, "vencida", "vencidas")} hoy`} tono={tareas.data && tareas.data.vencidas.total > 0 ? "danger" : undefined} />
      {(pipeline.isError || tareas.isError) && <div className="col-span-full text-sm text-danger">No se pudieron cargar los indicadores.</div>}
    </div>
  );
}

function Indicador({ etiqueta, valor, sub, tono, cargando }: { etiqueta: string; valor?: string; sub?: string | false; tono?: "ok" | "danger"; cargando: boolean }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-2">{etiqueta}</div>
      <div className="mt-1 font-heading text-[26px] font-extrabold">{cargando ? "…" : (valor ?? "—")}</div>
      {sub && <div className={`mt-0.5 text-xs font-semibold ${tono === "ok" ? "text-ok" : tono === "danger" ? "text-danger" : "text-ink-3"}`}>{sub}</div>}
    </Card>
  );
}

// --- Desempeño por agente ---------------------------------------------------------

function DesempenoPorAgente({ filtros }: { filtros: Filtros }) {
  const { data, isPending, isError } = useReporte<DesempenoAgente[]>("desempeno-por-agente", filtros);
  const encabezados = ["Agente", "Llamadas", "WhatsApp", "Comentarios", "Actividades", "Tareas cerradas", "Tareas vencidas", "Ganadas", "Ingresos cerrados"];

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">
        <Encabezado titulo="Desempeño por agente" nota="Agentes activos. Las tareas vencidas son las de hoy, sin importar el periodo.">
          <BotonExportar reporte="desempeno-por-agente" filtros={filtros} />
        </Encabezado>
      </div>
      <div className="px-5">
        <Estado isPending={isPending} isError={isError} />
      </div>
      {data && data.length === 0 && <div className="px-5 pb-5 text-sm text-ink-3">No hay agentes activos{filtros.responsableId ? " con ese filtro" : ""}.</div>}
      {data && data.length > 0 && (
        <div className="overflow-x-auto">
          <div className="tabla-scroll"><table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {encabezados.map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-2 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.responsable_id} className="border-t border-border text-[13px] tabular-nums">
                  <td className="px-4 py-3 font-semibold">{a.responsable_nombre}</td>
                  <Num>{a.actividades.llamada}</Num>
                  <Num>{a.actividades.whatsapp}</Num>
                  <Num>{a.actividades.comentario}</Num>
                  <Num fuerte>{a.actividades.total}</Num>
                  <Num>{a.tareas.cerradas}</Num>
                  <Num clase={a.tareas.vencidas > 0 ? "font-semibold text-danger" : undefined}>{a.tareas.vencidas}</Num>
                  <Num>{a.oportunidades.ganadas}</Num>
                  <Num fuerte>{formatoMonedaEntera.format(Number(a.oportunidades.ingresos_cerrados))}</Num>
                </tr>
              ))}
            </tbody>
            {data.length > 1 && (
              <tfoot>
                <tr className="border-t-2 border-border bg-bg text-[13px] font-bold tabular-nums">
                  <td className="px-4 py-3">Total</td>
                  <Num>{suma(data, (a) => a.actividades.llamada)}</Num>
                  <Num>{suma(data, (a) => a.actividades.whatsapp)}</Num>
                  <Num>{suma(data, (a) => a.actividades.comentario)}</Num>
                  <Num>{suma(data, (a) => a.actividades.total)}</Num>
                  <Num>{suma(data, (a) => a.tareas.cerradas)}</Num>
                  <Num>{suma(data, (a) => a.tareas.vencidas)}</Num>
                  <Num>{suma(data, (a) => a.oportunidades.ganadas)}</Num>
                  <Num>{formatoMonedaEntera.format(suma(data, (a) => Number(a.oportunidades.ingresos_cerrados)))}</Num>
                </tr>
              </tfoot>
            )}
          </table></div>
        </div>
      )}
    </Card>
  );
}

function suma<T>(filas: T[], valor: (f: T) => number) {
  return filas.reduce((acc, f) => acc + valor(f), 0);
}

function Num({ children, fuerte, clase }: { children: ReactNode; fuerte?: boolean; clase?: string }) {
  return <td className={`px-4 py-3 text-right ${clase ?? (fuerte ? "font-semibold" : "text-ink-2")}`}>{children}</td>;
}

// --- Conversión y forecast ----------------------------------------------------------

function Conversion({ filtros }: { filtros: Filtros }) {
  const { data, isPending, isError } = useReporte<ConversionEtapas>("pipeline/conversion-etapas", filtros);
  return (
    <Card className="p-5">
      <Encabezado titulo="Conversión por etapa" nota="Oportunidades que llegaron a cada etapa y % sobre las que entraron como calificadas.">
        <BotonExportar reporte="conversion-etapas" filtros={filtros} />
      </Encabezado>
      <Estado isPending={isPending} isError={isError} />
      {data && data.base_calificadas === 0 && data.etapas.length === 0 && <div className="text-sm text-ink-3">Sin movimientos de etapa en el periodo.</div>}
      {data && data.etapas.length > 0 && (
        <>
          <GraficaConversion datos={data} />
          <div className="mt-4 border-t border-border pt-3 text-xs text-ink-2">
            Perdidas: <span className="font-bold text-ink">{data.perdidas.oportunidades}</span>
            {data.perdidas.tasa_perdida_pct != null && ` (${data.perdidas.tasa_perdida_pct}% de las calificadas)`}
          </div>
        </>
      )}
    </Card>
  );
}

// El forecast proyecta el pipeline ABIERTO por mes de cierre estimado: no
// usa el periodo (que es para cosas que ya pasaron), solo el agente. Los
// meses ya vencidos aparecen igual: son oportunidades con la fecha de
// cierre atrasada que alguien debería actualizar.
function Forecast({ responsableId }: { responsableId?: number }) {
  const filtros = { responsableId };
  const { data, isPending, isError } = useReporte<ForecastMes[]>("forecast", filtros);
  const mesActual = isoLocal(new Date()).slice(0, 7);

  return (
    <Card className="p-5">
      <Encabezado titulo="Forecast mensual" nota="Pipeline abierto por mes de cierre estimado (no depende del periodo).">
        <BotonExportar reporte="forecast" filtros={filtros} />
      </Encabezado>
      <Estado isPending={isPending} isError={isError} />
      {data && data.length === 0 && <div className="text-sm text-ink-3">No hay oportunidades abiertas con fecha de cierre estimada.</div>}
      {data && data.length > 0 && (
        <>
          <GraficaForecast meses={data} />
          <div className="tabla-scroll tabla-compacta"><table className="mt-4 w-full border-collapse text-xs tabular-nums">
            <thead>
              <tr className="text-ink-2">
                <th className="py-1.5 text-left font-bold">Mes</th>
                <th className="py-1.5 text-right font-bold">Oport.</th>
                <th className="py-1.5 text-right font-bold">Estimado</th>
                <th className="py-1.5 text-right font-bold">Ponderado</th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.mes} className="border-t border-border">
                  <td className="py-1.5">
                    {etiquetaMes(m.mes)}
                    {m.mes < mesActual && <span className="ml-1.5 rounded-full bg-warn-bg px-1.5 py-0.5 text-[10px] font-bold text-warn">atrasado</span>}
                  </td>
                  <td className="py-1.5 text-right text-ink-2">{m.cantidad}</td>
                  <td className="py-1.5 text-right">{formatoMonedaEntera.format(Number(m.valor_estimado_total))}</td>
                  <td className="py-1.5 text-right font-semibold">{formatoMonedaEntera.format(Number(m.valor_ponderado))}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </>
      )}
    </Card>
  );
}

// --- Tareas por tipo ------------------------------------------------------------------


function TareasPorTipo({ filtros }: { filtros: Filtros }) {
  const { data, isPending, isError } = useReporte<ReporteTareas>("tareas", filtros);
  const tipos = data ? [...new Set([...data.cerradas.por_tipo, ...data.vencidas.por_tipo].map((f) => f.tipo))] : [];
  const cantidad = (lista: { tipo: string; cantidad: number }[], tipo: string) => lista.find((f) => f.tipo === tipo)?.cantidad ?? 0;

  return (
    <Card className="p-5">
      <Encabezado titulo="Tareas por tipo" nota="Cerradas en el periodo · vencidas hoy.">
        <BotonExportar reporte="tareas" filtros={filtros} />
      </Encabezado>
      <Estado isPending={isPending} isError={isError} />
      {data && tipos.length === 0 && <div className="text-sm text-ink-3">Sin tareas cerradas en el periodo ni vencidas.</div>}
      {data && tipos.length > 0 && (
        <table className="w-full max-w-xl border-collapse text-[13px] tabular-nums">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-ink-2">
              <th className="py-2 text-left font-bold">Tipo</th>
              <th className="py-2 text-right font-bold">Cerradas</th>
              <th className="py-2 text-right font-bold">Vencidas</th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((t) => (
              <tr key={t} className="border-t border-border">
                <td className="py-2">{ETIQUETA_TIPO_TAREA[t]}</td>
                <td className="py-2 text-right text-ink-2">{cantidad(data.cerradas.por_tipo, t)}</td>
                <td className={`py-2 text-right ${cantidad(data.vencidas.por_tipo, t) > 0 ? "font-semibold text-danger" : "text-ink-2"}`}>{cantidad(data.vencidas.por_tipo, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// --- Prospección ----------------------------------------------------------------------

// Envíos y respuestas de la automatización (n8n). Los correos no tienen
// agente: el filtro de agente no aplica, solo el periodo y, opcional, la
// campaña (campanaId de GET /reportes/prospeccion).
function Prospeccion({ rango, filtradoPorAgente }: { rango: Pick<Filtros, "fechaInicio" | "fechaFin">; filtradoPorAgente: boolean }) {
  const [campanaId, setCampanaId] = useState("");
  const { data: campanas } = useCampanas();
  const filtros: Filtros = { ...rango, campanaId: campanaId ? Number(campanaId) : undefined };
  const { data, isPending, isError } = useReporte<ReporteProspeccion>("prospeccion", filtros);
  const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">
        <Encabezado
          titulo="Prospección"
          nota={`Correos de la automatización. La tasa es de las personas contactadas en el periodo que respondieron; las respuestas automáticas no cuentan${filtradoPorAgente ? " (no se filtra por agente)" : ""}.`}
        >
          {campanas && campanas.data.length > 0 && (
            <select aria-label="Campaña" className={`${inputBaseClass} w-auto py-1.5 text-xs`} value={campanaId} onChange={(e) => setCampanaId(e.target.value)}>
              <option value="">Todas las campañas</option>
              {campanas.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </select>
          )}
          <BotonExportar reporte="prospeccion" filtros={filtros} />
        </Encabezado>
      </div>
      <div className="px-5">
        <Estado isPending={isPending} isError={isError} />
      </div>
      {data && data.envios.total === 0 && data.respuestas.total === 0 && data.respuestas.automaticas === 0 && <div className="px-5 pb-5 text-sm text-ink-3">Sin correos ni respuestas en el periodo.</div>}
      {data && (data.envios.total > 0 || data.respuestas.total > 0 || data.respuestas.automaticas > 0) && (
        <>
          <div className="grid grid-cols-2 gap-4 px-5 pb-5 xl:grid-cols-4">
            <Dato etiqueta="Correos enviados" valor={data.envios.total} sub={`${data.envios.inicial} iniciales · ${data.envios.recordatorio_1 + data.envios.recordatorio_2} recordatorios`} />
            <Dato etiqueta="Personas contactadas" valor={data.envios.personas_contactadas} sub={plural(data.respuestas.personas_que_respondieron, "respondió", "respondieron")} />
            <Dato etiqueta="Tasa de respuesta" valor={pct(data.tasa_respuesta_pct)} />
            <Dato
              etiqueta="Respuestas recibidas"
              valor={data.respuestas.total}
              sub={[data.respuestas.pendientes_clasificar > 0 && `${data.respuestas.pendientes_clasificar} sin clasificar`, data.respuestas.tardias > 0 && plural(data.respuestas.tardias, "tardía", "tardías"), data.respuestas.automaticas > 0 && plural(data.respuestas.automaticas, "automática aparte", "automáticas aparte")].filter(Boolean).join(" · ")}
            />
          </div>
          {data.respuestas.por_clasificacion.length > 0 && (
            <div className="flex flex-wrap gap-2 px-5 pb-5 text-xs">
              {data.respuestas.por_clasificacion.map((c) => (
                <span key={c.clasificacion} className="rounded-full border border-border px-2.5 py-1">
                  {ETIQUETA_CLASIFICACION[c.clasificacion as Clasificacion] ?? c.clasificacion}: <span className="font-bold">{c.cantidad}</span>
                </span>
              ))}
            </div>
          )}
          {data.por_campana.length > 0 && (
            <div className="overflow-x-auto">
              <div className="tabla-scroll"><table className="w-full border-collapse text-[13px] tabular-nums">
                <thead>
                  <tr className="bg-bg">
                    {["Campaña", "Correos", "Personas", "Respondieron", "Tasa"].map((h, i) => (
                      <th key={h} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-2 ${i === 0 ? "text-left" : "text-right"}`}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.por_campana.map((c) => (
                    <tr key={c.campana_id ?? "sin"} className="border-t border-border">
                      <td className="px-4 py-3 font-semibold">{c.campana_nombre}</td>
                      <Num>{c.envios}</Num>
                      <Num>{c.personas_contactadas}</Num>
                      <Num>{c.personas_que_respondieron}</Num>
                      <Num fuerte>{pct(c.tasa_respuesta_pct)}</Num>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Dato({ etiqueta, valor, sub }: { etiqueta: string; valor: number | string; sub?: string }) {
  return (
    <div className="rounded-[10px] border border-border px-4 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-2">{etiqueta}</div>
      <div className="mt-1 font-heading text-[22px] font-extrabold tabular-nums">{valor}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  );
}

// --- Métricas diarias ---------------------------------------------------------------------

// Foto diaria que deja el job de ReportesService.calcularMetricasDelDia():
// agregado global, sin dimensión por agente.
function MetricasDiarias({ fechaInicio, fechaFin, filtradoPorAgente }: { fechaInicio?: string; fechaFin?: string; filtradoPorAgente: boolean }) {
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data, isPending, isError } = useQuery({
    queryKey: ["reportes", "metricas-diarias", { fechaInicio, fechaFin }],
    queryFn: () => api.get<MetricaDiaria[]>("/api/v1/reportes/metricas-diarias", { fechaInicio, fechaFin })
  });

  async function recalcular() {
    setOcupado(true);
    setError(null);
    try {
      await api.post("/api/v1/reportes/metricas-diarias/calcular");
      await queryClient.invalidateQueries({ queryKey: ["reportes", "metricas-diarias"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-5">
        <Encabezado titulo="Histórico diario" nota={`Una foto por día del pipeline de toda la empresa${filtradoPorAgente ? " (no se filtra por agente)" : ""}.`}>
          <Button variant="ghost" className="border border-border px-3 py-1.5 text-xs" disabled={ocupado} onClick={recalcular}>
            Recalcular hoy
          </Button>
        </Encabezado>
      </div>
      <div className="px-5">
        <ServerError message={error} />
        <Estado isPending={isPending} isError={isError} />
      </div>
      {data && data.length === 0 && <div className="px-5 pb-5 text-sm text-ink-3">No hay fotos diarias en el periodo.</div>}
      {data && data.length > 0 && (
        <div className="max-h-96 overflow-auto">
          <div className="tabla-scroll"><table className="w-full border-collapse text-[13px] tabular-nums">
            <thead className="sticky top-0">
              <tr className="bg-bg">
                {["Fecha", "Abiertas", "Valor pipeline", "Ganadas", "Ingresos", "Perdidas", "Valor perdido"].map((h, i) => (
                  <th key={h} className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-ink-2 ${i === 0 ? "text-left" : "text-right"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.fecha} className="border-t border-border" title={`Calculado ${formatoFechaHora.format(new Date(m.calculado_en))}`}>
                  <td className="px-4 py-2.5">{formatoFecha.format(fechaLocal(m.fecha))}</td>
                  <Num>{m.oportunidades_abiertas}</Num>
                  <Num fuerte>{formatoMonedaEntera.format(Number(m.valor_pipeline))}</Num>
                  <Num>{m.oportunidades_ganadas}</Num>
                  <Num>{formatoMonedaEntera.format(Number(m.ingresos_cerrados))}</Num>
                  <Num>{m.oportunidades_perdidas}</Num>
                  <Num>{formatoMonedaEntera.format(Number(m.valor_perdido))}</Num>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </Card>
  );
}
