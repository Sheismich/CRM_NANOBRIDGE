import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Card, SectionTitle } from "../components/ui/Card";
import { EstadoVacio, LigaAccion } from "../components/ui/EstadoVacio";
import { GraficaForecast } from "../components/reportes/Graficas";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { formatoFechaHora, formatoMonedaEntera as formatoMoneda, plural } from "../lib/formato";
import { CLASE_PRIORIDAD, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, LIMITE_COLA, estaVencida, useColaClasificacion, useTareasAbiertas, venceHoy } from "../lib/tareas";
import type { DesempenoAgente, ForecastMes, PipelineResumen, ReporteProspeccion, Tarea } from "../types";

// Inicio (PLAN_FRONTEND.md, "Pantallas menos genéricas"). Admin y
// supervisor, de arriba abajo: qué hacer hoy, prospección del mes,
// campañas, y más abajo pipeline, forecast y actividad por agente. El
// agente ve sus tareas, con aviso si tiene respuestas por contestar.
// Color: azul de marca solo en acciones; verde / ámbar / rojo para estados.
// Todo sale de endpoints que ya existen; el detalle vive en Reportes.
export function DashboardPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";

  return (
    <AppShell titulo="Inicio">
      <div className="mb-5 text-sm text-ink-2">Hola, {user?.nombre.split(" ")[0]}.</div>
      {esAdminOSupervisor ? (
        <div className="flex flex-col gap-5">
          <QueHacerHoy />
          <ProspeccionDelMes />
          <ResumenPipeline />
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ForecastProximo />
            <ActividadDelMes />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <AvisoRespuestasPorContestar />
          <MisTareas />
        </div>
      )}
    </AppShell>
  );
}

type Tono = "ok" | "warn" | "danger" | "neutro";

const CLASE_TONO: Record<Tono, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  neutro: "bg-bg text-ink-2"
};

// Vencidas primero, luego las de hoy, luego el resto en el orden de la API
// (prioridad y fecha límite).
function urgencia(t: Tarea) {
  if (estaVencida(t)) return 0;
  if (venceHoy(t)) return 1;
  return 2;
}

// --- Admin / supervisor -------------------------------------------------------

// Lo de hoy siempre visible, también en cero: "0 por clasificar" en verde
// dice que la cola está al día, que también es información.
function QueHacerHoy() {
  const cola = useColaClasificacion();
  const abiertas = useTareasAbiertas();

  const porClasificar = cola.data?.data.length ?? 0;
  const tareas = abiertas.data?.tareas ?? [];
  const vencidas = tareas.filter(estaVencida);
  const deHoy = tareas.filter(venceHoy);
  const urgentes = [...vencidas, ...deHoy].slice(0, 5);
  const mas = abiertas.data && !abiertas.data.completo ? "+" : "";

  return (
    <Card className="p-6">
      <SectionTitle>Qué hacer hoy</SectionTitle>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Indicador
          etiqueta="Respuestas por clasificar"
          valor={cola.isPending ? "…" : cola.isError ? "—" : `${porClasificar}${porClasificar >= LIMITE_COLA ? "+" : ""}`}
          detalle={porClasificar === 0 ? "La cola está al día" : "La automatización no pudo clasificarlas sola"}
          tono={cola.isPending || cola.isError ? "neutro" : porClasificar === 0 ? "ok" : "warn"}
          accion={porClasificar > 0 ? <LigaAccion to="/tareas?tab=cola">Ir a la cola</LigaAccion> : undefined}
        />
        <Indicador
          etiqueta="Tareas vencidas"
          valor={abiertas.isPending ? "…" : abiertas.isError ? "—" : `${vencidas.length}${mas}`}
          detalle={vencidas.length === 0 ? "Ninguna fuera de tiempo" : "Fecha límite pasada y siguen abiertas"}
          tono={abiertas.isPending || abiertas.isError ? "neutro" : vencidas.length === 0 ? "ok" : "danger"}
        />
        <Indicador
          etiqueta="Vencen hoy"
          valor={abiertas.isPending ? "…" : abiertas.isError ? "—" : `${deHoy.length}${mas}`}
          detalle={deHoy.length === 0 ? "Nada con fecha de hoy" : "Todavía a tiempo"}
          tono={abiertas.isPending || abiertas.isError ? "neutro" : deHoy.length === 0 ? "ok" : "warn"}
        />
      </div>
      {abiertas.isError && <div className="mt-3 text-sm text-danger">No se pudieron cargar las tareas.</div>}
      {urgentes.length > 0 && (
        <div className="mt-4">
          <ListaTareas tareas={urgentes} />
          <div className="mt-3 text-right">
            <Link to="/tareas" className="text-xs font-semibold text-navy hover:underline">
              Ir a Tareas
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}

// Embudo del mes con GET /reportes/prospeccion. Empieza en "contactadas":
// el backend no guarda aperturas. Contactadas y respondieron son personas;
// interesados son respuestas clasificadas así (una persona que contestó
// dos veces cuenta doble), y las que siguen por clasificar no entran.
function ProspeccionDelMes() {
  const fechaInicio = inicioDeMes(new Date());
  const { data, isPending, isError } = useQuery({
    queryKey: ["reportes", "prospeccion", { fechaInicio }],
    queryFn: () => api.get<ReporteProspeccion>("/api/v1/reportes/prospeccion", { fechaInicio })
  });
  const interesados = data?.respuestas.por_clasificacion.find((c) => c.clasificacion === "interesado")?.cantidad ?? 0;
  const pendientes = data?.respuestas.pendientes_clasificar ?? 0;

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
      <Card className="p-6">
        <TituloConLiga titulo="Prospección este mes" />
        {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="text-sm text-danger">No se pudo cargar la prospección.</div>}
        {data && data.envios.personas_contactadas === 0 && (
          <EstadoVacio titulo="Este mes todavía no sale ningún correo de la automatización." accion={<LigaAccion to="/prospectos?tab=campanas">Ver campañas</LigaAccion>} />
        )}
        {data && data.envios.personas_contactadas > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <PasoEmbudo etiqueta="Contactadas" valor={data.envios.personas_contactadas} sub={plural(data.envios.total, "correo", "correos")} />
            <PasoEmbudo etiqueta="Respondieron" valor={data.respuestas.personas_que_respondieron} sub={`Tasa ${pct(data.tasa_respuesta_pct)}`} />
            <PasoEmbudo etiqueta="Interesados" valor={interesados} sub={pendientes > 0 ? `${pendientes} por clasificar` : "respuestas"} final />
          </div>
        )}
      </Card>
      <CampanasDelMes porCampana={data?.por_campana} cargando={isPending} error={isError} />
    </div>
  );
}

function CampanasDelMes({ porCampana, cargando, error }: { porCampana?: ReporteProspeccion["por_campana"]; cargando: boolean; error: boolean }) {
  return (
    <Card className="p-6">
      <div className="flex items-start justify-between gap-3">
        <SectionTitle>Campañas este mes</SectionTitle>
        <Link to="/prospectos?tab=campanas" className="text-xs font-semibold text-navy hover:underline">
          Ver campañas
        </Link>
      </div>
      {cargando && <div className="text-sm text-ink-2">Cargando…</div>}
      {error && <div className="text-sm text-danger">No se pudieron cargar las campañas.</div>}
      {porCampana && porCampana.length === 0 && (
        <EstadoVacio titulo="Ninguna campaña mandó correos este mes." />
      )}
      {porCampana && porCampana.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {porCampana.map((c) => (
            <li key={c.campana_id ?? "sin"}>
              <Link to="/prospectos?tab=campanas" className="flex flex-col gap-1 py-2.5 text-[13px] hover:text-navy sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="font-semibold">{c.campana_nombre}</span>
                <span className="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap text-xs tabular-nums text-ink-2">
                  <span>{plural(c.personas_contactadas, "contactada", "contactadas")}</span>
                  <span>{plural(c.personas_que_respondieron, "respondió", "respondieron")}</span>
                  <span className="font-semibold text-ink">{pct(c.tasa_respuesta_pct)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// Más chico que antes: el detalle está en Reportes.
function ResumenPipeline() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["reportes", "pipeline-resumen"],
    queryFn: () => api.get<PipelineResumen>("/api/v1/reportes/pipeline/resumen")
  });

  if (isPending) return <div className="text-sm text-ink-2">Cargando…</div>;
  if (isError || !data) return <div className="text-sm text-danger">No se pudo cargar el resumen del pipeline.</div>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Metrica etiqueta="Oportunidades abiertas" valor={String(data.abiertas.cantidad)} sub={formatoMoneda.format(Number(data.abiertas.valor_pipeline))} />
      <Metrica etiqueta="Ganadas" valor={String(data.ganadas.cantidad)} sub={formatoMoneda.format(Number(data.ganadas.ingresos_cerrados))} tono="ok" />
      <Metrica etiqueta="Perdidas" valor={String(data.perdidas.cantidad)} sub={formatoMoneda.format(Number(data.perdidas.valor_perdido))} tono="danger" />
    </div>
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
      {data && proximos.length === 0 && (
        <EstadoVacio titulo="No hay oportunidades abiertas con cierre estimado de este mes en adelante." accion={<LigaAccion to="/oportunidades">Ver oportunidades</LigaAccion>} />
      )}
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
      {data && agentes.length === 0 && <EstadoVacio titulo="No hay agentes activos." />}
      {agentes.length > 0 && (
        <ul className="flex flex-col divide-y divide-border">
          {agentes.map((a) => (
            <li key={a.responsable_id} className="flex flex-col gap-1 py-2.5 text-[13px] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              <span className="font-semibold">{a.responsable_nombre}</span>
              <span className="flex flex-wrap gap-x-4 gap-y-1 whitespace-nowrap text-xs tabular-nums text-ink-2">
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

// --- Agente -------------------------------------------------------------------

// Un "interesado" deja una tarea de seguimiento ligada a la respuesta
// (respuesta_id); ya asignada al agente, es una respuesta que tiene que
// contestar. Sin respuestas pendientes no se muestra nada.
function AvisoRespuestasPorContestar() {
  const { data } = useTareasAbiertas();
  const n = (data?.tareas ?? []).filter((t) => t.tipo === "seguimiento" && t.respuesta_id !== null).length;
  if (n === 0) return null;
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-l-4 border-l-warn px-5 py-4">
      <div>
        <div className="text-sm font-bold">{n === 1 ? "Tienes 1 respuesta por contestar" : `Tienes ${n} respuestas por contestar`}</div>
        <div className="text-xs text-ink-3">Prospectos que contestaron con interés y esperan que los contactes.</div>
      </div>
      <LigaAccion to="/tareas">Ir a mis tareas</LigaAccion>
    </Card>
  );
}

function MisTareas() {
  const { data, isPending, isError } = useTareasAbiertas();
  const tareas = [...(data?.tareas ?? [])].sort((a, b) => urgencia(a) - urgencia(b)).slice(0, 10);

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
      {data && tareas.length === 0 && (
        <EstadoVacio titulo="No tienes tareas pendientes. Buen momento para registrar actividad con tus empresas." accion={<LigaAccion to="/empresas">Ver mis empresas</LigaAccion>} />
      )}
      {tareas.length > 0 && <ListaTareas tareas={tareas} />}
    </Card>
  );
}

// --- Piezas -------------------------------------------------------------------

function ListaTareas({ tareas }: { tareas: Tarea[] }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {tareas.map((tarea) => {
        const vencida = estaVencida(tarea);
        const hoy = venceHoy(tarea);
        return (
          <li key={tarea.id} className="flex items-center justify-between gap-3 rounded-[10px] border border-border px-4 py-3">
            <div className="min-w-0">
              <div className="text-[13px] font-semibold">{tarea.titulo}</div>
              <div className="text-xs text-ink-3">
                {[ETIQUETA_TIPO_TAREA[tarea.tipo], tarea.empresa_nombre].filter(Boolean).join(" · ")}
                {tarea.fecha_limite && (
                  <span className={vencida ? "font-semibold text-danger" : hoy ? "font-semibold text-warn" : ""}>
                    {" · "}
                    {vencida ? "Venció " : hoy ? "Vence hoy " : "Vence "}
                    {formatoFechaHora.format(new Date(tarea.fecha_limite))}
                  </span>
                )}
              </div>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${CLASE_PRIORIDAD[tarea.prioridad]}`}>{ETIQUETA_PRIORIDAD[tarea.prioridad]}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Indicador({ etiqueta, valor, detalle, tono, accion }: { etiqueta: string; valor: string; detalle: string; tono: Tono; accion?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-[10px] border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-ink-2">{etiqueta}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[15px] font-bold tabular-nums ${CLASE_TONO[tono]}`}>{valor}</span>
      </div>
      <div className="text-xs text-ink-3">{detalle}</div>
      {accion && <div>{accion}</div>}
    </div>
  );
}

function PasoEmbudo({ etiqueta, valor, sub, final }: { etiqueta: string; valor: number; sub: string; final?: boolean }) {
  return (
    <div className="rounded-[10px] bg-bg p-3">
      <div className="text-xs font-semibold text-ink-2">{etiqueta}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${final && valor > 0 ? "text-ok" : ""}`}>{valor}</div>
      <div className="mt-0.5 text-xs text-ink-3">{sub}</div>
    </div>
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

const pct = (v: number | null) => (v == null ? "—" : `${v}%`);

// "YYYY-MM-01" del mes local.
function inicioDeMes(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function Metrica({ etiqueta, valor, sub, tono }: { etiqueta: string; valor: string; sub: string; tono?: "ok" | "danger" }) {
  return (
    <Card className="flex items-baseline justify-between gap-3 px-5 py-3.5">
      <div>
        <div className="text-xs font-semibold text-ink-2">{etiqueta}</div>
        <div className={`mt-0.5 text-xs font-semibold ${tono === "ok" ? "text-ok" : tono === "danger" ? "text-danger" : "text-ink-3"}`}>{sub}</div>
      </div>
      <div className="text-xl font-bold tabular-nums">{valor}</div>
    </Card>
  );
}
