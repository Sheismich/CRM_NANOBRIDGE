import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Ficha } from "../ui/Ficha";
import { Icono } from "../ui/Icono";
import { MarcaDeAgua } from "../ui/MarcaDeAgua";
import { Pastilla } from "../ui/Pastilla";
import { Tarjeta } from "../ui/Tarjeta";
import type { Tono } from "../ui/tonos";
import { ModalHecha, ModalReprogramar } from "./AccionesTarea";
import { api } from "../../lib/api";
import { isoDia } from "../../lib/inicio";
import { cajaHora, grupoDe, hace, hora, ligaTelefono, ordenarPorUrgencia, textoVence, type Grupo } from "../../lib/mi-dia";
import { plural } from "../../lib/formato";
import { ETIQUETA_CLASIFICACION, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, asignarTarea, useColaClasificacion, useConteosTareas, useListaTareas, useTareaDetalle } from "../../lib/tareas";
import type { Clasificacion, EventoReciente, ProspeccionDia, Tarea, TareaDetalle } from "../../types";

// Mi día (docs/diseno/tareas.html, opción 3, con los ajustes del 11-oct):
// arriba la siguiente tarea que toca, en grande; abajo "Después"; a la
// derecha el avance del día y, para administrador y supervisor, la cola de
// clasificación, lo que nadie tiene asignado y lo que hizo la
// automatización hoy. "Saltar" solo vive en la pantalla: manda la tarea al
// final mientras no se recargue.

const DESPUES = 5;
const TONO_GRUPO: Record<Grupo, Tono> = { vencidas: "danger", hoy: "warn", proximas: "navy", sin_fecha: "neutro", cerradas: "ok" };
const TEXTO_GRUPO: Record<Grupo, string> = { vencidas: "Vencida", hoy: "Hoy", proximas: "Próxima", sin_fecha: "Sin fecha", cerradas: "Cerrada" };

type Basica = { id: number; titulo: string };

export function MiDia({ usuarioId, esAdminOSupervisor, onIrACola }: { usuarioId: number; esAdminOSupervisor: boolean; onIrACola: () => void }) {
  const ahora = new Date();
  const lista = useListaTareas({ responsableId: usuarioId });
  const [saltadas, setSaltadas] = useState<number[]>([]);
  const [primero, setPrimero] = useState<number | null>(null);
  const [haciendo, setHaciendo] = useState<Basica | null>(null);
  const [reprogramando, setReprogramando] = useState<Basica | null>(null);

  // Orden: la que se eligió a mano, luego por urgencia, y las saltadas al
  // final en el orden en que se saltaron.
  const ordenadas = ordenarPorUrgencia(lista.data?.tareas ?? [], ahora);
  const normales = ordenadas.filter((t) => !saltadas.includes(t.id) && t.id !== primero);
  const elegida = ordenadas.find((t) => t.id === primero);
  const cola = [...(elegida ? [elegida] : []), ...normales, ...saltadas.map((id) => ordenadas.find((t) => t.id === id)).filter((t): t is Tarea => Boolean(t))];
  const siguiente = cola[0] ?? null;
  const detalle = useTareaDetalle(siguiente?.id ?? null);

  function saltar(id: number) {
    setPrimero(null);
    setSaltadas((s) => [...s.filter((x) => x !== id), id]);
  }
  function trabajar(id: number) {
    setPrimero(id);
    setSaltadas((s) => s.filter((x) => x !== id));
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-5">
      <div className="min-w-0">
        {lista.isPending && <p className="text-[13px] text-ink-3">Cargando tus tareas…</p>}
        {lista.isError && <p className="text-[13px] text-danger">No se pudieron cargar tus tareas.</p>}
        {lista.data && !siguiente && (
          <Tarjeta className="min-h-[200px]">
            <MarcaDeAgua className="-bottom-[70px] -right-10 w-[300px]" />
            <div className="relative">
              <h2 className="font-heading text-[24px] font-black text-strong">Nada pendiente</h2>
              <p className="mt-2 max-w-md text-[14px] text-ink-2">No tienes tareas abiertas. Si quedaste en llamar o escribirle a alguien, anótalo con «Nueva tarea» para que no se te pase.</p>
            </div>
          </Tarjeta>
        )}
        {siguiente && (
          <TarjetaSiguiente
            tarea={siguiente}
            detalle={detalle.data?.id === siguiente.id ? detalle.data : undefined}
            ahora={ahora}
            esAdminOSupervisor={esAdminOSupervisor}
            hayMas={cola.length > 1}
            onHecha={() => setHaciendo(siguiente)}
            onReprogramar={() => setReprogramando(siguiente)}
            onSaltar={() => saltar(siguiente.id)}
            onIrACola={onIrACola}
          />
        )}
        {cola.length > 1 && (
          <div className="mt-6">
            <div className="mb-2.5 flex flex-wrap items-baseline gap-2">
              <h3 className="font-heading text-[17px] font-extrabold text-strong">Después</h3>
              <span className="font-heading text-[11px] font-extrabold tracking-[1.5px] text-ink-3">{cola.length - 1} MÁS</span>
              <span className="ml-auto text-[12px] text-ink-3">Ordenado por hora de vencimiento</span>
            </div>
            <ul className="flex flex-col gap-2.5">
              {cola.slice(1, 1 + DESPUES).map((t) => (
                <FilaDespues
                  key={t.id}
                  tarea={t}
                  ahora={ahora}
                  saltada={saltadas.includes(t.id)}
                  onTrabajar={() => trabajar(t.id)}
                  onHecha={() => (t.tipo === "clasificacion" ? onIrACola() : setHaciendo(t))}
                />
              ))}
            </ul>
            {cola.length - 1 > DESPUES && <p className="mt-2 text-[12px] text-ink-3">Y {plural(cola.length - 1 - DESPUES, "más", "más")} en «Ver todas».</p>}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <Avance ahora={ahora} tareas={lista.data?.tareas ?? []} />
        {esAdminOSupervisor && <CuadroCola onIrACola={onIrACola} />}
        {esAdminOSupervisor && <DelEquipo usuarioId={usuarioId} ahora={ahora} />}
        {esAdminOSupervisor && <Automatizacion ahora={ahora} />}
      </div>

      <ModalHecha
        tarea={haciendo}
        onCerrar={() => setHaciendo(null)}
        onHecha={() => {
          if (haciendo?.id === primero) setPrimero(null);
        }}
      />
      <ModalReprogramar tarea={reprogramando} onCerrar={() => setReprogramando(null)} />
    </div>
  );
}

function TarjetaSiguiente({
  tarea,
  detalle,
  ahora,
  esAdminOSupervisor,
  hayMas,
  onHecha,
  onReprogramar,
  onSaltar,
  onIrACola
}: {
  tarea: Tarea;
  detalle?: TareaDetalle;
  ahora: Date;
  esAdminOSupervisor: boolean;
  hayMas: boolean;
  onHecha: () => void;
  onReprogramar: () => void;
  onSaltar: () => void;
  onIrACola: () => void;
}) {
  const grupo = grupoDe(tarea, ahora);
  const respuesta = detalle?.respuesta;
  const clasificacion = respuesta?.clasificacion ?? respuesta?.clasificacion_sugerida ?? null;
  const textoClasificacion = clasificacion ? (ETIQUETA_CLASIFICACION[clasificacion as Clasificacion] ?? clasificacion).toLowerCase() : null;

  return (
    <section className={clsx("tarjeta-blanca relative overflow-hidden px-5 py-6 md:px-7 md:py-7", grupo === "vencidas" && "border-t-[3px] !border-t-danger")}>
      <MarcaDeAgua className="-bottom-[70px] -right-10 w-[340px]" />
      <div className="relative">
        <div className="flex flex-wrap items-center gap-2">
          <Pastilla tono={TONO_GRUPO[grupo]} punto mayusculas>
            {TEXTO_GRUPO[grupo]}
          </Pastilla>
          <span className="rounded-[8px] bg-soft px-2 py-0.5 text-[12px] font-bold text-ink-2">Prioridad: {ETIQUETA_PRIORIDAD[tarea.prioridad]}</span>
          <span className={clsx("ml-auto inline-flex items-center gap-1.5 text-[13px]", grupo === "vencidas" ? "text-danger" : "text-ink-3")}>
            <Icono nombre="reloj" size={15} />
            {textoVence(tarea.fecha_limite, ahora)}
          </span>
        </div>

        <h2 className="mt-3 font-heading text-[24px] font-black leading-tight text-strong md:text-[32px]">{tarea.titulo}</h2>

        <div className="mt-4 flex flex-wrap gap-2">
          {tarea.empresa_id && (
            <Ficha icono="empresa" to={`/empresas/${tarea.empresa_id}`}>
              {detalle?.empresa_nombre ?? tarea.empresa_nombre ?? "Empresa"}
            </Ficha>
          )}
          {detalle?.contacto_nombre && (
            <Ficha icono="persona">
              {detalle.contacto_nombre}
              {detalle.contacto_puesto && ` (${detalle.contacto_puesto})`}
            </Ficha>
          )}
          {detalle?.campana_nombre && <Ficha icono={<span className="block h-2 w-2 rounded-full bg-mint" />}>Campaña: {detalle.campana_nombre}</Ficha>}
          <Ficha>{ETIQUETA_TIPO_TAREA[tarea.tipo]}</Ficha>
        </div>

        {respuesta?.contenido ? (
          <div className="mt-5 rounded-[14px] border border-border bg-soft/85 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
              <Icono nombre="info" size={16} className="text-info" />
              <b className="text-strong">Lo que contestó</b>
              <span className="text-ink-3">
                {textoClasificacion && (
                  <>
                    · {respuesta.clasificacion ? "se clasificó como" : "la IA sugiere"} <b className="text-ok">{textoClasificacion}</b>
                  </>
                )}
                {respuesta.recibido_en && ` · ${hace(respuesta.recibido_en, ahora)}`}
              </span>
            </div>
            <p className="mt-2 text-[14px] italic leading-relaxed text-ink">“{respuesta.contenido}”</p>
            {respuesta.motivo_sugerencia && <p className="mt-1.5 text-[12px] text-ink-3">Por qué lo dice la IA: {respuesta.motivo_sugerencia}</p>}
          </div>
        ) : (
          tarea.descripcion && <p className="mt-5 whitespace-pre-wrap rounded-[14px] border border-border bg-soft/85 px-4 py-3.5 text-[14px] leading-relaxed text-ink">{tarea.descripcion}</p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          {tarea.tipo === "clasificacion" ? (
            esAdminOSupervisor ? (
              <button type="button" onClick={onIrACola} className={claseBotonGrande("principal")}>
                <Icono nombre="flechaDerecha" size={18} /> Clasificar en la cola
              </button>
            ) : (
              <span className="text-[13px] text-ink-2">Esta respuesta la clasifica un supervisor.</span>
            )
          ) : (
            <button type="button" onClick={onHecha} className={claseBotonGrande("principal")}>
              <Icono nombre="checkCirculo" size={18} /> Hecha
            </button>
          )}
          <button type="button" onClick={onReprogramar} className={claseBotonGrande("suave")}>
            <Icono nombre="calendario" size={18} /> Reprogramar
          </button>
          {hayMas && (
            <button type="button" onClick={onSaltar} className="inline-flex items-center gap-2 px-3 py-3 text-[14px] font-bold text-ink-3 hover:text-strong">
              <Icono d="M6 5v14 M10 5l9 7-9 7z" size={17} /> Saltar
            </button>
          )}
          {detalle?.contacto_telefono && (
            <a
              href={ligaTelefono(detalle.contacto_telefono)}
              target={detalle.contacto_telefono.tipo === "whatsapp" ? "_blank" : undefined}
              rel="noreferrer"
              className="mono inline-flex items-center gap-2 rounded-[12px] bg-ok-bg px-4 py-3 text-[14px] font-extrabold text-ok md:ml-auto"
            >
              <Icono nombre="telefono" size={17} />
              {detalle.contacto_telefono.valor}
              {detalle.contacto_telefono.tipo === "whatsapp" && <small className="font-bold">WhatsApp</small>}
            </a>
          )}
        </div>
      </div>
    </section>
  );
}

function claseBotonGrande(tipo: "principal" | "suave") {
  return clsx(
    "inline-flex items-center gap-2 rounded-[12px] px-5 py-3 text-[14px] font-extrabold",
    tipo === "principal" ? "bg-[image:var(--grad-boton)] text-white shadow-[0_10px_22px_-12px_rgba(42,68,155,0.8)]" : "bg-navy-bg text-navy"
  );
}

function FilaDespues({ tarea, ahora, saltada, onTrabajar, onHecha }: { tarea: Tarea; ahora: Date; saltada: boolean; onTrabajar: () => void; onHecha: () => void }) {
  const caja = cajaHora(tarea.fecha_limite, ahora);
  const vencida = grupoDe(tarea, ahora) === "vencidas";
  return (
    <li className="tarjeta-blanca flex items-center gap-3 !rounded-[14px] px-3 py-3 md:px-4">
      <button type="button" onClick={onTrabajar} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Trabajar esta ahora">
        <span className={clsx("grid w-[58px] shrink-0 place-items-center rounded-[10px] py-2 text-center", vencida ? "bg-danger-bg text-danger" : "bg-navy-bg text-navy")}>
          {caja ? (
            <>
              <b className="mono text-[15px] font-extrabold leading-none">{caja.arriba}</b>
              <small className="mt-1 text-[9.5px] font-extrabold tracking-[1px]">{caja.abajo}</small>
            </>
          ) : (
            <>
              <Icono nombre="calendario" size={15} />
              <small className="mt-1 text-[9.5px] font-extrabold tracking-[1px]">S/FECHA</small>
            </>
          )}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-1.5">
            <b className="text-[14px] font-bold text-strong">{tarea.titulo}</b>
            {tarea.estado === "en_progreso" ? <Pastilla tono="ok">En progreso</Pastilla> : <Pastilla tono={tarea.prioridad === "urgente" ? "danger" : tarea.prioridad === "alta" ? "warn" : "neutro"}>{ETIQUETA_PRIORIDAD[tarea.prioridad]}</Pastilla>}
            {saltada && <Pastilla tono="neutro">Saltada</Pastilla>}
          </span>
          <small className="mt-0.5 block truncate text-[12px] text-ink-3">{[tarea.empresa_nombre, ETIQUETA_TIPO_TAREA[tarea.tipo]].filter(Boolean).join(" · ")}</small>
        </span>
      </button>
      <button
        type="button"
        onClick={onHecha}
        aria-label={tarea.tipo === "clasificacion" ? "Clasificar en la cola" : "Marcar como hecha"}
        title={tarea.tipo === "clasificacion" ? "Clasificar en la cola" : "Marcar como hecha"}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-ink-3/60 text-transparent hover:border-ok hover:text-ok"
      >
        <Icono nombre="check" size={13} strokeWidth={3} />
      </button>
    </li>
  );
}

// Anillo "1/3 HOY · 33% completado": cerradas hoy de (cerradas hoy +
// abiertas que vencen hoy), de /tareas/conteos.
function Avance({ ahora, tareas }: { ahora: Date; tareas: Tarea[] }) {
  const { data: c } = useConteosTareas();
  if (!c) return <Tarjeta className="min-h-[120px]" />;
  const total = c.cerradas_hoy + c.pendientes_hoy;
  const porcentaje = total > 0 ? Math.round((c.cerradas_hoy / total) * 100) : 0;
  const siguienteHoy = ordenarPorUrgencia(tareas, ahora).find((t) => grupoDe(t, ahora) === "hoy");
  const r = 38;
  const largo = 2 * Math.PI * r;

  const titulo = c.vencidas > 0 ? `Tienes ${plural(c.vencidas, "vencida", "vencidas")}` : total === 0 ? "Día libre" : porcentaje === 100 ? "¡Terminaste!" : "Vas bien";
  return (
    <Tarjeta>
      <div className="flex items-center gap-4">
        <div className="relative h-[92px] w-[92px] shrink-0">
          <svg viewBox="0 0 92 92" className="h-full w-full -rotate-90" aria-hidden="true">
            <defs>
              <linearGradient id="anillo-avance" x1="0" x2="1">
                <stop offset="0" stopColor="#41e198" />
                <stop offset="1" stopColor="#23bad3" />
              </linearGradient>
            </defs>
            <circle cx="46" cy="46" r={r} fill="none" stroke="var(--border)" strokeWidth="9" />
            <circle cx="46" cy="46" r={r} fill="none" stroke="url(#anillo-avance)" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(largo * porcentaje) / 100} ${largo}`} />
          </svg>
          <span className="absolute inset-0 grid place-items-center text-center">
            <span>
              <b className="mono block font-display text-[24px] leading-none text-strong">
                {c.cerradas_hoy}/{total}
              </b>
              <small className="text-[9.5px] font-extrabold tracking-[1.5px] text-ink-3">HOY</small>
            </span>
          </span>
        </div>
        <div className="min-w-0">
          <div className={clsx("flex items-center gap-1 font-heading text-[11px] font-extrabold uppercase tracking-[2px]", c.vencidas > 0 ? "text-danger" : "text-ok")}>
            <Icono nombre={c.vencidas > 0 ? "aviso" : "tendencia"} size={14} /> {titulo}
          </div>
          <b className="mt-0.5 block font-heading text-[20px] font-black text-strong">{porcentaje}% completado</b>
          <p className="mt-1 text-[12.5px] leading-snug text-ink-2">
            {total === 0
              ? "Hoy no vence ninguna de tus tareas."
              : `${c.cerradas_hoy} de ${plural(total, "tarea de hoy", "tareas de hoy")} ${c.cerradas_hoy === 1 ? "cerrada" : "cerradas"}.${c.pendientes_hoy > 0 ? ` Te ${c.pendientes_hoy === 1 ? "queda" : "quedan"} ${c.pendientes_hoy}${siguienteHoy?.fecha_limite ? `, la siguiente a las ${hora(new Date(siguienteHoy.fecha_limite))}` : ""}.` : ""}`}{" "}
            {c.cerradas_ayer > 0 && `Ayer cerraste ${c.cerradas_ayer}.`}
          </p>
        </div>
      </div>
    </Tarjeta>
  );
}

function CuadroCola({ onIrACola }: { onIrACola: () => void }) {
  const { data } = useColaClasificacion();
  const n = data?.data.length ?? 0;
  if (n === 0) return null;
  return (
    <Tarjeta>
      <div className="flex gap-3.5">
        <span className="mono grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-info-bg font-display text-[24px] text-info">{n}</span>
        <div className="min-w-0">
          <div className="text-[10.5px] font-extrabold uppercase tracking-[1.5px] text-ok">● Revisión requerida</div>
          <b className="font-heading text-[17px] font-extrabold text-strong">Cola de clasificación</b>
          <p className="mt-0.5 text-[12.5px] text-ink-2">{plural(n, "respuesta", "respuestas")} por clasificar · La IA no pudo sola.</p>
          <button type="button" onClick={onIrACola} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-bold text-strong hover:text-navy">
            Ir a la cola <Icono nombre="flechaDerecha" size={15} />
          </button>
        </div>
      </div>
    </Tarjeta>
  );
}

function DelEquipo({ usuarioId, ahora }: { usuarioId: number; ahora: Date }) {
  const queryClient = useQueryClient();
  const { data } = useListaTareas({ sinAsignar: true });
  const [tomando, setTomando] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sinAsignar = ordenarPorUrgencia(data?.tareas ?? [], ahora);

  async function tomar(t: Tarea) {
    setTomando(t.id);
    setError(null);
    try {
      await asignarTarea(queryClient, t.id, usuarioId, t.empresa_id);
    } catch {
      setError("No se pudo tomar la tarea. Puede que alguien más ya la haya tomado.");
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
    } finally {
      setTomando(null);
    }
  }

  return (
    <Tarjeta titulo="Del equipo" icono="equipo" extra={sinAsignar.length > 0 && <Pastilla tono="navy" mayusculas>{`${sinAsignar.length}${data?.completo ? "" : "+"} sin asignar`}</Pastilla>} cuerpoClassName="!pt-3">
      {data && sinAsignar.length === 0 && <p className="text-[13px] text-ink-2">Nada sin asignar.</p>}
      <ul className="flex flex-col gap-2">
        {sinAsignar.slice(0, 4).map((t) => (
          <li key={t.id} className="flex items-center gap-3 rounded-[12px] bg-soft px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <b className="block truncate text-[13px] text-strong">{t.titulo}</b>
              <small className="block truncate text-[11.5px] text-ink-3">{[t.empresa_nombre, ETIQUETA_TIPO_TAREA[t.tipo]].filter(Boolean).join(" · ")}</small>
            </div>
            <button
              type="button"
              disabled={tomando !== null}
              onClick={() => void tomar(t)}
              className="shrink-0 rounded-[10px] border border-border bg-card px-3 py-1.5 text-[12.5px] font-bold text-strong hover:border-navy/40 disabled:opacity-50"
            >
              {tomando === t.id ? "…" : "Tomar"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="mt-2 text-[12px] text-danger">{error}</p>}
    </Tarjeta>
  );
}

// Panel morado: lo que la automatización hizo hoy, en una frase. Sale de
// /reportes/prospeccion/por-dia (hoy) y del último envío del feed.
function Automatizacion({ ahora }: { ahora: Date }) {
  const hoy = isoDia(ahora);
  const porDia = useQuery({
    queryKey: ["reportes", "prospeccion-por-dia", { fechaInicio: hoy, fechaFin: hoy }],
    queryFn: () => api.get<ProspeccionDia[]>("/api/v1/reportes/prospeccion/por-dia", { fechaInicio: hoy, fechaFin: hoy }),
    refetchInterval: 5 * 60_000
  });
  const feed = useQuery({
    queryKey: ["reportes", "actividad-reciente"],
    queryFn: () => api.get<EventoReciente[]>("/api/v1/reportes/actividad-reciente", { limit: 30 }),
    refetchInterval: 60_000
  });
  const dia = porDia.data?.[0];
  const ultimoEnvio = feed.data?.find((e) => e.tipo === "envio" && isoDia(new Date(e.fecha)) === hoy);

  return (
    <section className="rounded-[18px] bg-[linear-gradient(135deg,#2a449b,#5b2d86)] px-5 py-5 text-white shadow-[0_18px_34px_-18px_rgba(91,45,134,0.8)]">
      <div className="flex items-center justify-between font-heading text-[11px] font-extrabold uppercase tracking-[2px] text-mint">
        Automatización NANOBRIDGE <Icono nombre="rayo" size={16} />
      </div>
      <p className="mt-3 text-[14px] leading-relaxed text-white/90">
        {!dia ? (
          "Revisando…"
        ) : dia.envios === 0 ? (
          <>Hoy todavía no sale ningún correo.{dia.respuestas > 0 && <> Llegaron <b className="text-white">{plural(dia.respuestas, "respuesta", "respuestas")}</b>.</>}</>
        ) : (
          <>
            Hoy {dia.envios === 1 ? "salió" : "salieron"} <b className="text-white">{plural(dia.envios, "correo", "correos")}</b>
            {ultimoEnvio?.campana_nombre && ` de la campaña ${ultimoEnvio.campana_nombre}`}
            {ultimoEnvio && `, el último a las ${hora(new Date(ultimoEnvio.fecha))}`}. Llegaron <b className="text-white">{plural(dia.respuestas, "respuesta", "respuestas")}</b>.
          </>
        )}
      </p>
      <Link to="/" className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-white/80 hover:text-white">
        Ver en el Inicio <Icono nombre="flechaDerecha" size={14} />
      </Link>
    </section>
  );
}
