import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Card, SectionTitle } from "../components/ui/Card";
import { GraficaForecast } from "../components/reportes/Graficas";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { formatoMonedaEntera as formatoMoneda, plural } from "../lib/formato";
import { ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, textoPendientesCola, useColaClasificacion } from "../lib/tareas";
import type { DesempenoAgente, ForecastMes, Paginated, PipelineResumen, Tarea } from "../types";

// PLAN_FRONTEND.md §5: "Agente: mis tareas pendientes" / "Admin/Supervisor:
// resumen de pipeline, forecast, actividad por agente, cola de
// clasificación". La cola se trabaja en Tareas (?tab=cola); el detalle de
// cada reporte (periodos, filtros, CSV) vive en Reportes (ReportesPage).
export function DashboardPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";

  return (
    <AppShell titulo="Inicio">
      <div className="mb-5 text-sm text-ink-2">Hola, {user?.nombre.split(" ")[0]}.</div>
      {esAdminOSupervisor ? (
        <div className="flex flex-col gap-5">
          <ResumenPipeline />
          <AvisoCola />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ForecastProximo />
            <ActividadDelMes />
          </div>
        </div>
      ) : (
        <MisTareas />
      )}
    </AppShell>
  );
}

function ResumenPipeline() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["reportes", "pipeline-resumen"],
    queryFn: () => api.get<PipelineResumen>("/api/v1/reportes/pipeline/resumen")
  });

  if (isPending) return <div className="text-sm text-ink-2">Cargando…</div>;
  if (isError || !data) return <div className="text-sm text-danger">No se pudo cargar el resumen del pipeline.</div>;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Metrica etiqueta="Oportunidades abiertas" valor={String(data.abiertas.cantidad)} sub={formatoMoneda.format(Number(data.abiertas.valor_pipeline))} />
      <Metrica etiqueta="Ganadas" valor={String(data.ganadas.cantidad)} sub={formatoMoneda.format(Number(data.ganadas.ingresos_cerrados))} tono="ok" />
      <Metrica etiqueta="Perdidas" valor={String(data.perdidas.cantidad)} sub={formatoMoneda.format(Number(data.perdidas.valor_perdido))} tono="danger" />
    </div>
  );
}

// Solo aparece si hay respuestas esperando: con la cola vacía no hay nada
// que hacer y la tarjeta sería ruido.
function AvisoCola() {
  const { data } = useColaClasificacion();
  const n = data?.data.length ?? 0;
  if (n === 0) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-cyan px-5 py-4">
      <div>
        <div className="text-sm font-bold">{textoPendientesCola(n)}</div>
        <div className="text-xs text-ink-3">Respuestas que la automatización no pudo clasificar sola.</div>
      </div>
      <Link to="/tareas?tab=cola" className="rounded-[9px] border-[1.5px] border-navy bg-card px-4 py-2 text-[13px] font-bold text-navy">
        Ir a la cola
      </Link>
    </Card>
  );
}

// Solo los meses de hoy en adelante (los atrasados se ven en Reportes).
function ForecastProximo() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["reportes", "forecast", {}],
    queryFn: () => api.get<ForecastMes[]>("/api/v1/reportes/forecast")
  });
  const mesActual = inicioDeMes(new Date()).slice(0, 7);
  const proximos = (data ?? []).filter((m) => m.mes >= mesActual).slice(0, 6);

  return (
    <Card className="p-6">
      <TituloConLiga titulo="Forecast de los próximos meses" />
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar el forecast.</div>}
      {data && proximos.length === 0 && <div className="text-sm text-ink-3">No hay oportunidades abiertas con cierre estimado de este mes en adelante.</div>}
      {proximos.length > 0 && <GraficaForecast meses={proximos} />}
    </Card>
  );
}

function ActividadDelMes() {
  const fechaInicio = inicioDeMes(new Date());
  const { data, isPending, isError } = useQuery({
    queryKey: ["reportes", "desempeno-por-agente", { fechaInicio }],
    queryFn: () => api.get<DesempenoAgente[]>("/api/v1/reportes/desempeno-por-agente", { fechaInicio })
  });
  const agentes = [...(data ?? [])].sort((a, b) => b.actividades.total - a.actividades.total);

  return (
    <Card className="p-6">
      <TituloConLiga titulo="Actividad por agente este mes" />
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar la actividad.</div>}
      {data && agentes.length === 0 && <div className="text-sm text-ink-3">No hay agentes activos.</div>}
      {agentes.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {agentes.map((a) => (
            <li key={a.responsable_id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
              <span className="font-semibold">{a.responsable_nombre}</span>
              <span className="flex gap-4 text-xs tabular-nums text-ink-2">
                <span>{plural(a.actividades.total, "actividad", "actividades")}</span>
                <span>{plural(a.oportunidades.ganadas, "ganada", "ganadas")}</span>
                {a.tareas.vencidas > 0 && <span className="font-semibold text-danger">{plural(a.tareas.vencidas, "vencida", "vencidas")}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TituloConLiga({ titulo }: { titulo: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <SectionTitle>{titulo}</SectionTitle>
      <Link to="/reportes" className="text-xs font-semibold text-navy hover:underline">
        Ver reportes
      </Link>
    </div>
  );
}

// "YYYY-MM-01" del mes local.
function inicioDeMes(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function Metrica({ etiqueta, valor, sub, tono }: { etiqueta: string; valor: string; sub: string; tono?: "ok" | "danger" }) {
  return (
    <Card className="p-5">
      <div className="text-xs font-semibold text-ink-2">{etiqueta}</div>
      <div className="mt-1.5 text-[28px] font-bold">{valor}</div>
      <div className={`mt-1 text-xs font-semibold ${tono === "ok" ? "text-ok" : tono === "danger" ? "text-danger" : "text-ink-3"}`}>{sub}</div>
    </Card>
  );
}

function MisTareas() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["tareas", "pendientes-propias"],
    queryFn: () => api.get<Paginated<Tarea>>("/api/v1/tareas", { estado: "pendiente", limit: 10 })
  });

  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle>Mis tareas pendientes</SectionTitle>
        <Link to="/tareas" className="text-xs font-semibold text-navy hover:underline">
          Ver todas
        </Link>
      </div>
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudieron cargar tus tareas.</div>}
      {data && data.data.length === 0 && <div className="text-sm text-ink-3">No tienes tareas pendientes.</div>}
      {data && data.data.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {data.data.map((tarea) => (
            <li key={tarea.id} className="flex items-center justify-between rounded-[10px] border border-border px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold">{tarea.titulo}</div>
                <div className="text-xs text-ink-3">{ETIQUETA_TIPO_TAREA[tarea.tipo]}</div>
              </div>
              <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-ink-2">{ETIQUETA_PRIORIDAD[tarea.prioridad]}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
