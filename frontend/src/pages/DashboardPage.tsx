import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { ChipVivo, Franja, Kpi } from "../components/ui/Franja";
import { Tarjeta } from "../components/ui/Tarjeta";
import { Pastilla } from "../components/ui/Pastilla";
import { GraficaCorreosPorDia } from "../components/inicio/GraficaCorreosPorDia";
import { LoQueAcabaDePasar } from "../components/inicio/LoQueAcabaDePasar";
import { CampanasInicio } from "../components/inicio/CampanasInicio";
import { PipelineAbierto } from "../components/inicio/PipelineAbierto";
import { NuevaOportunidadPanel } from "../components/inicio/NuevaOportunidadPanel";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { useCampanas } from "../lib/campanas";
import { etiquetaRango, fechaFranja, pct, rangosInicio, saludo } from "../lib/inicio";
import { formatoFechaHora } from "../lib/formato";
import { useAhora } from "../lib/reloj";
import { CLASE_PRIORIDAD, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, estaVencida, useColaClasificacion, useConteosTareas, useTareasAbiertas, venceHoy } from "../lib/tareas";
import type { EventoReciente, PipelineResumen, ProspeccionDia, ReporteProspeccion, Tarea } from "../types";

// Inicio del rediseño (docs/diseno/inicio-aprobado.html, aprobado por el
// jefe el 9-oct-2026, ajuste del 11-oct). Fondo en relieve, franja azul con
// la prospección del mes, gráfica de correos por día, "Lo que acaba de
// pasar", campañas y pipeline abierto. Los reportes son solo de
// administrador y supervisor (ReportesController), así que el agente ve la
// misma franja con SUS números de tareas y su lista de pendientes.
export function DashboardPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  // Cambia cada minuto: la hora de la franja, el saludo y el "hace N min"
  // del feed siguen vivos. Las consultas no se repiten porque sus llaves
  // son fechas "YYYY-MM-DD", que no cambian dentro del día.
  const ahora = useAhora();
  const nombre = user?.nombre.split(" ")[0] ?? "";

  return (
    <AppShell titulo="Inicio" encabezado={null} fondo="relieve">
      {esAdminOSupervisor ? <InicioEquipo ahora={ahora} nombre={nombre} /> : <InicioAgente ahora={ahora} nombre={nombre} />}
    </AppShell>
  );
}

// --- Administrador / supervisor -------------------------------------------------

function InicioEquipo({ ahora, nombre }: { ahora: Date; nombre: string }) {
  const r = rangosInicio(ahora);
  const [creando, setCreando] = useState(false);

  const mes = useProspeccion(r.mes);
  const hoy = useProspeccion({ fechaInicio: r.hoy, fechaFin: r.hoy });
  const anterior = useProspeccion(r.mesAnterior);
  const porDia = useQuery({
    queryKey: ["reportes", "prospeccion-por-dia", r.grafica],
    queryFn: () => api.get<ProspeccionDia[]>("/api/v1/reportes/prospeccion/por-dia", r.grafica),
    refetchInterval: 5 * 60_000
  });
  const feed = useQuery({
    queryKey: ["reportes", "actividad-reciente"],
    queryFn: () => api.get<EventoReciente[]>("/api/v1/reportes/actividad-reciente", { limit: 30 }),
    refetchInterval: 60_000
  });
  const pipeline = useQuery({
    queryKey: ["reportes", "pipeline-resumen", r.mes],
    queryFn: () => api.get<PipelineResumen>("/api/v1/reportes/pipeline/resumen", r.mes)
  });
  const campanas = useCampanas();
  const cola = useColaClasificacion();

  const interesados = (d?: ReporteProspeccion) => d?.respuestas.por_clasificacion.find((c) => c.clasificacion === "interesado")?.cantidad ?? 0;
  const n = (v: number | undefined) => (mes.isPending ? "…" : mes.isError ? "—" : String(v ?? 0));
  const masHoy = (v: number | undefined) => (hoy.data ? `+${v ?? 0} hoy` : undefined);
  const automatizacionActiva = (campanas.data?.data ?? []).some((c) => c.activa_hoy);

  return (
    <>
      <Franja
        ceja="Conectando la ficción con la realidad"
        chips={
          campanas.data &&
          (automatizacionActiva ? (
            <ChipVivo>Automatización activa</ChipVivo>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/8 px-2.5 py-1 text-[12px] font-bold text-white/70">Sin campañas activas</span>
          ))
        }
        fecha={fechaFranja(ahora)}
        titulo={`${saludo(ahora)}, ${nombre}`}
        subtitulo={`Así va la prospección de ${r.nombreMes}.`}
      >
        <Kpi valor={n(mes.data?.envios.personas_contactadas)} etiqueta="Personas contactadas" detalle={masHoy(hoy.data?.envios.personas_contactadas)} />
        <Kpi valor={n(mes.data?.respuestas.personas_que_respondieron)} etiqueta="Respondieron" detalle={masHoy(hoy.data?.respuestas.personas_que_respondieron)} />
        <Kpi valor={n(mes.data && interesados(mes.data))} etiqueta="Interesados" detalle={hoy.data && `+${interesados(hoy.data)} hoy`} />
        <Kpi
          valor={mes.isPending ? "…" : pct(mes.data?.tasa_respuesta_pct)}
          etiqueta="Tasa de respuesta"
          detalle={anterior.data && `${r.nombreMesAnterior}: ${anterior.data.tasa_respuesta_pct == null ? "sin envíos" : pct(anterior.data.tasa_respuesta_pct)}`}
          resaltado
        />
      </Franja>

      <div className="mt-4 grid grid-cols-1 gap-4 md:mt-[22px] lg:grid-cols-2">
        <Tarjeta estilo="relieve" titulo="Correos enviados por día" icono="correo" color="menta" extra={etiquetaRango(r.grafica.fechaInicio, r.grafica.fechaFin)}>
          {porDia.isPending && <Cargando />}
          {porDia.isError && <ErrorCarga que="la gráfica" />}
          {porDia.data && <GraficaCorreosPorDia dias={porDia.data} hoy={r.hoy} />}
        </Tarjeta>
        <Tarjeta
          estilo="relieve"
          titulo="Lo que acaba de pasar"
          icono="campana"
          color="cyan"
          extra={
            <span className="inline-flex items-center gap-1.5">
              <span className="punto-vivo" /> en vivo
            </span>
          }
        >
          {feed.isPending && <Cargando />}
          {feed.isError && <ErrorCarga que="la actividad reciente" />}
          {feed.data && <LoQueAcabaDePasar eventos={feed.data} pendientesCola={cola.data?.data.length} ahora={ahora} />}
        </Tarjeta>
      </div>

      <div className="mt-4 grid grid-cols-1 items-stretch gap-4 min-[980px]:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <Tarjeta estilo="relieve" titulo="Campañas" icono="bandera" color="lila" extra="tasa de respuesta">
          {mes.isPending && <Cargando />}
          {mes.isError && <ErrorCarga que="las campañas" />}
          {mes.data && <CampanasInicio porCampana={mes.data.por_campana} campanas={campanas.data?.data ?? []} />}
        </Tarjeta>
        <Tarjeta estilo="relieve" className="encabezado-morado" cuerpoClassName="h-full">
          {pipeline.isPending && <Cargando />}
          {pipeline.isError && <ErrorCarga que="el pipeline" />}
          {pipeline.data && <PipelineAbierto resumen={pipeline.data} onCrear={() => setCreando(true)} />}
        </Tarjeta>
      </div>

      <NuevaOportunidadPanel abierto={creando} onCerrar={() => setCreando(false)} />
    </>
  );
}

function useProspeccion(rango: { fechaInicio: string; fechaFin: string }) {
  return useQuery({
    queryKey: ["reportes", "prospeccion", rango],
    queryFn: () => api.get<ReporteProspeccion>("/api/v1/reportes/prospeccion", rango)
  });
}

// --- Agente ---------------------------------------------------------------------

function InicioAgente({ ahora, nombre }: { ahora: Date; nombre: string }) {
  const conteos = useConteosTareas();
  const abiertas = useTareasAbiertas();
  const c = conteos.data;
  const n = (v: number | undefined) => (conteos.isPending ? "…" : conteos.isError ? "—" : String(v ?? 0));
  // Un "interesado" deja una tarea de seguimiento ligada a la respuesta: es
  // una respuesta que el agente tiene que contestar.
  const porContestar = (abiertas.data?.tareas ?? []).filter((t) => t.tipo === "seguimiento" && t.respuesta_id !== null).length;
  const tareas = [...(abiertas.data?.tareas ?? [])].sort((a, b) => urgencia(a) - urgencia(b)).slice(0, 8);

  return (
    <>
      <Franja ceja="Conectando la ficción con la realidad" fecha={fechaFranja(ahora)} titulo={`${saludo(ahora)}, ${nombre}`} subtitulo="Esto es lo que te toca hoy.">
        <Kpi valor={n(c?.pendientes_hoy)} etiqueta="Vencen hoy" />
        <Kpi valor={n(c?.vencidas)} etiqueta="Vencidas" detalle={c && c.vencidas > 0 ? "atiéndelas primero" : undefined} />
        <Kpi valor={n(c?.cerradas_hoy)} etiqueta="Cerraste hoy" resaltado />
        <Kpi valor={n(c?.cerradas_ayer)} etiqueta="Cerraste ayer" />
      </Franja>

      {porContestar > 0 && (
        <Tarjeta estilo="relieve" className="mt-4 md:mt-[22px]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-heading text-[15px] font-extrabold text-strong">{porContestar === 1 ? "Tienes 1 respuesta por contestar" : `Tienes ${porContestar} respuestas por contestar`}</div>
              <div className="text-[13px] text-ink-2">Prospectos que contestaron con interés y esperan que los contactes.</div>
            </div>
            <Link to="/tareas" className="rounded-[12px] bg-[image:var(--grad-boton)] px-4 py-2.5 text-[13.5px] font-extrabold text-white">
              Ir a mis tareas
            </Link>
          </div>
        </Tarjeta>
      )}

      <Tarjeta
        estilo="relieve"
        titulo="Mis tareas pendientes"
        icono="check"
        color="cyan"
        className="mt-4"
        extra={
          <Link to="/tareas" className="font-bold text-navy hover:underline">
            Ver todas
          </Link>
        }
      >
        {abiertas.isPending && <Cargando />}
        {abiertas.isError && <ErrorCarga que="tus tareas" />}
        {abiertas.data && tareas.length === 0 && <p className="text-[13px] text-ink-2">No tienes tareas pendientes. Buen momento para registrar actividad con tus empresas.</p>}
        {tareas.length > 0 && (
          <ul>
            {tareas.map((t) => (
              <FilaTarea key={t.id} tarea={t} />
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}

// Vencidas primero, luego las de hoy, luego el resto en el orden de la API.
function urgencia(t: Tarea) {
  if (estaVencida(t)) return 0;
  if (venceHoy(t)) return 1;
  return 2;
}

function FilaTarea({ tarea }: { tarea: Tarea }) {
  const vencida = estaVencida(tarea);
  const hoy = venceHoy(tarea);
  return (
    <li className="flex items-center justify-between gap-3 border-t border-[var(--relieve-linea)] py-3 first:border-t-0 first:pt-0">
      <Link to="/tareas" className="min-w-0">
        <div className="text-[13.5px] font-bold text-strong">{tarea.titulo}</div>
        <div className="text-[12px] text-ink-3">
          {[ETIQUETA_TIPO_TAREA[tarea.tipo], tarea.empresa_nombre].filter(Boolean).join(" · ")}
          {tarea.fecha_limite && (
            <span className={clsx(vencida ? "font-bold text-danger" : hoy && "font-bold text-warn")}>
              {" · "}
              {vencida ? "Venció " : hoy ? "Vence hoy " : "Vence "}
              {formatoFechaHora.format(new Date(tarea.fecha_limite))}
            </span>
          )}
        </div>
      </Link>
      {vencida ? (
        <Pastilla tono="danger" punto>
          Vencida
        </Pastilla>
      ) : (
        <span className={clsx("shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold", CLASE_PRIORIDAD[tarea.prioridad])}>{ETIQUETA_PRIORIDAD[tarea.prioridad]}</span>
      )}
    </li>
  );
}

// --- Piezas -------------------------------------------------------------------

function Cargando() {
  return <p className="text-[13px] text-ink-3">Cargando…</p>;
}

function ErrorCarga({ que }: { que: string }) {
  return <p className="text-[13px] text-danger">No se pudo cargar {que}. Se vuelve a intentar sola en un momento.</p>;
}

