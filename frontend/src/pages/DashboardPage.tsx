import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Card, SectionTitle } from "../components/ui/Card";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import type { Paginated, Tarea } from "../types";

type PipelineResumen = {
  abiertas: { cantidad: number; valor_pipeline: string };
  ganadas: { cantidad: number; ingresos_cerrados: string };
  perdidas: { cantidad: number; valor_perdido: string };
};

const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });

// PLAN_FRONTEND.md §5: "Agente: mis tareas pendientes, mi cola de
// clasificación" / "Admin/Supervisor: resumen de pipeline, forecast,
// actividad por agente". Primera versión: solo el resumen de pipeline
// (admin/supervisor) o la bandeja propia (agente) -- forecast y actividad
// por agente llegan en una fase posterior.
export function DashboardPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";

  return (
    <AppShell titulo="Inicio">
      <div className="mb-5 text-sm text-ink-2">Hola, {user?.nombre.split(" ")[0]}.</div>
      {esAdminOSupervisor ? <ResumenPipeline /> : <MisTareas />}
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
    <div className="grid grid-cols-3 gap-4">
      <Metrica etiqueta="Oportunidades abiertas" valor={String(data.abiertas.cantidad)} sub={formatoMoneda.format(Number(data.abiertas.valor_pipeline))} />
      <Metrica etiqueta="Ganadas" valor={String(data.ganadas.cantidad)} sub={formatoMoneda.format(Number(data.ganadas.ingresos_cerrados))} tono="ok" />
      <Metrica etiqueta="Perdidas" valor={String(data.perdidas.cantidad)} sub={formatoMoneda.format(Number(data.perdidas.valor_perdido))} tono="danger" />
    </div>
  );
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
      <SectionTitle>Mis tareas pendientes</SectionTitle>
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudieron cargar tus tareas.</div>}
      {data && data.data.length === 0 && <div className="text-sm text-ink-3">No tienes tareas pendientes.</div>}
      {data && data.data.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {data.data.map((tarea) => (
            <li key={tarea.id} className="flex items-center justify-between rounded-[10px] border border-border px-4 py-3">
              <div>
                <div className="text-[13px] font-semibold">{tarea.titulo}</div>
                <div className="text-xs text-ink-3">{tarea.tipo}</div>
              </div>
              <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-ink-2">{tarea.prioridad}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
