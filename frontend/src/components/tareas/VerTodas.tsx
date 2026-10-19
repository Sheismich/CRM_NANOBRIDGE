import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { clsx } from "clsx";
import { Ficha } from "../ui/Ficha";
import { Icono } from "../ui/Icono";
import { PanelLateral } from "../ui/PanelLateral";
import { inputBaseClass } from "../ui/Field";
import { ColaClasificacion } from "./ColaClasificacion";
import { DetalleTarea, Avatar } from "./DetalleTarea";
import { ModalHecha, ModalReprogramar } from "./AccionesTarea";
import { ETIQUETA_GRUPO, grupoDe, ordenarPorUrgencia, venceCorto, type Grupo } from "../../lib/mi-dia";
import { useEsCelular } from "../../lib/pantalla";
import { ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, LIMITE_COLA, useColaClasificacion, useListaTareas, type FiltrosTareas } from "../../lib/tareas";
import type { Tarea, Usuario } from "../../types";

// "Ver todas" (docs/diseno/tareas.html, opción 6 · Lista + detalle):
// filtros arriba, lista agrupada por cuándo vence (Vencidas, Hoy,
// Próximas, Sin fecha) y el detalle a la derecha. Administrador y
// supervisor además eligen entre las suyas, todas, las sin asignar y la
// cola de clasificación. El círculo de cada fila la marca como hecha.

export type Alcance = "mias" | "todas" | "sin_asignar" | "cola";

const COLOR_GRUPO: Record<Grupo, string> = { vencidas: "text-danger", hoy: "text-warn", proximas: "text-navy", sin_fecha: "text-ink-3", cerradas: "text-ok" };
const BARRAS: Record<Tarea["prioridad"], { llenas: number; color: string }> = {
  urgente: { llenas: 3, color: "bg-danger" },
  alta: { llenas: 3, color: "bg-warn" },
  media: { llenas: 2, color: "bg-navy" },
  baja: { llenas: 1, color: "bg-ink-3" }
};

export function VerTodas({
  usuarioId,
  esAdminOSupervisor,
  usuarios,
  alcance,
  onAlcance
}: {
  usuarioId: number;
  esAdminOSupervisor: boolean;
  usuarios?: Usuario[];
  alcance: Alcance;
  onAlcance: (a: Alcance) => void;
}) {
  const ahora = new Date();
  const esCelular = useEsCelular();
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [prioridad, setPrioridad] = useState<Tarea["prioridad"] | "">("");
  const [tipo, setTipo] = useState<Tarea["tipo"] | "">("");
  const [cerradas, setCerradas] = useState(false);
  // ?tarea=ID: la abre ya elegida (liga de un aviso de la campanita),
  // también si la liga cambia con la pantalla ya abierta.
  const [params] = useSearchParams();
  const tareaDeLaLiga = Number(params.get("tarea")) || null;
  const [elegida, setElegida] = useState<number | null>(tareaDeLaLiga);
  const [ligaVista, setLigaVista] = useState(tareaDeLaLiga);
  if (tareaDeLaLiga !== ligaVista) {
    setLigaVista(tareaDeLaLiga);
    if (tareaDeLaLiga !== null) setElegida(tareaDeLaLiga);
  }
  const [haciendo, setHaciendo] = useState<Tarea | null>(null);
  const [reprogramando, setReprogramando] = useState<Tarea | null>(null);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setQ(texto), 300);
    return () => clearTimeout(t);
  }, [texto]);

  const filtros: FiltrosTareas = {
    responsableId: alcance === "mias" ? usuarioId : undefined,
    sinAsignar: alcance === "sin_asignar" || undefined,
    q,
    prioridad: prioridad || undefined,
    tipo: tipo || undefined,
    cerradas
  };
  const lista = useListaTareas(filtros, alcance !== "cola");
  const cola = useColaClasificacion(1, esAdminOSupervisor);
  const nCola = cola.data?.data.length ?? 0;
  const tareas = cerradas
    ? [...(lista.data?.tareas ?? [])].sort((a, b) => (b.cerrada_en ?? "").localeCompare(a.cerrada_en ?? ""))
    : ordenarPorUrgencia(lista.data?.tareas ?? [], ahora);

  // En compu siempre hay una abierta a la derecha: la primera de la lista
  // si no se ha elegido otra (o si la elegida ya no está, p. ej. al cerrarla).
  const seleccion = elegida !== null && tareas.some((t) => t.id === elegida) ? elegida : esCelular ? null : (tareas[0]?.id ?? null);

  const grupos = new Map<Grupo, Tarea[]>();
  for (const t of tareas) {
    const g = grupoDe(t, ahora);
    grupos.set(g, [...(grupos.get(g) ?? []), t]);
  }

  const nombreDe = (id: number | null) => (id == null ? null : (usuarios?.find((u) => u.id === id)?.nombre ?? null));
  const accionesDetalle = {
    esAdminOSupervisor,
    usuarios,
    onHecha: (t: Tarea) => setHaciendo(t),
    onReprogramar: (t: Tarea) => setReprogramando(t),
    onIrACola: () => onAlcance("cola")
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {esAdminOSupervisor && (
          <>
            <Ficha onClick={() => onAlcance("mias")} activa={alcance === "mias"}>
              Mis tareas
            </Ficha>
            <Ficha onClick={() => onAlcance("todas")} activa={alcance === "todas"}>
              Todas
            </Ficha>
            <Ficha onClick={() => onAlcance("sin_asignar")} activa={alcance === "sin_asignar"}>
              Sin asignar
            </Ficha>
            <Ficha onClick={() => onAlcance("cola")} activa={alcance === "cola"}>
              Cola de clasificación
              {nCola > 0 && <span className="ml-1.5 rounded-full bg-info-bg px-1.5 text-[11px] font-extrabold text-info">{nCola >= LIMITE_COLA ? `${nCola}+` : nCola}</span>}
            </Ficha>
          </>
        )}
        {alcance !== "cola" && (
          <>
            <label className="flex h-[38px] min-w-[200px] flex-1 items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-ink-3 md:ml-auto md:max-w-[280px]">
              <Icono nombre="buscar" size={16} />
              <input aria-label="Buscar tareas" placeholder="Buscar por tarea o empresa…" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" value={texto} onChange={(e) => setTexto(e.target.value)} />
            </label>
            <select aria-label="Prioridad" className={`${inputBaseClass} h-[38px] w-auto`} value={prioridad} onChange={(e) => setPrioridad(e.target.value as Tarea["prioridad"] | "")}>
              <option value="">Prioridad: todas</option>
              {Object.entries(ETIQUETA_PRIORIDAD).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select aria-label="Tipo" className={`${inputBaseClass} h-[38px] w-auto`} value={tipo} onChange={(e) => setTipo(e.target.value as Tarea["tipo"] | "")}>
              <option value="">Tipo: todos</option>
              {Object.entries(ETIQUETA_TIPO_TAREA).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select aria-label="Estado" className={`${inputBaseClass} h-[38px] w-auto`} value={cerradas ? "cerradas" : "abiertas"} onChange={(e) => setCerradas(e.target.value === "cerradas")}>
              <option value="abiertas">Abiertas</option>
              <option value="cerradas">Cerradas</option>
            </select>
          </>
        )}
      </div>

      {alcance === "cola" ? (
        <ColaClasificacion />
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-[minmax(320px,1fr)_minmax(0,1.15fr)] md:gap-[18px]">
          <div className="tarjeta-blanca overflow-hidden !rounded-[18px]">
            {lista.isPending && <p className="p-5 text-[13px] text-ink-3">Cargando…</p>}
            {lista.isError && <p className="p-5 text-[13px] text-danger">No se pudieron cargar las tareas.</p>}
            {lista.data && tareas.length === 0 && (
              <p className="p-5 text-[13px] text-ink-2">{q || prioridad || tipo ? "No hay tareas con ese filtro." : cerradas ? "Todavía no hay tareas cerradas aquí." : "No hay tareas abiertas aquí. Todo al día."}</p>
            )}
            {[...grupos.entries()].map(([g, lista]) => (
              <div key={g}>
                <div className="flex items-center gap-2 border-t border-border px-4 pb-1.5 pt-3 font-heading text-[11px] font-extrabold uppercase tracking-[1.5px] text-ink-3 first:border-t-0">
                  <span className={COLOR_GRUPO[g]}>●</span>
                  {ETIQUETA_GRUPO[g]}
                  <em className="not-italic text-ink-3/80">{lista.length}</em>
                </div>
                {lista.map((t) => (
                  <FilaTarea
                    key={t.id}
                    tarea={t}
                    ahora={ahora}
                    seleccionada={t.id === seleccion}
                    responsable={esAdminOSupervisor ? nombreDe(t.responsable_id) : null}
                    onElegir={() => setElegida(t.id)}
                    onHecha={() => (t.tipo === "clasificacion" ? onAlcance("cola") : setHaciendo(t))}
                  />
                ))}
              </div>
            ))}
            {lista.data && !lista.data.completo && <p className="border-t border-border px-4 py-2.5 text-[12px] text-ink-3">Se muestran las primeras 100. Usa la búsqueda o los filtros para encontrar otras.</p>}
          </div>

          {!esCelular && seleccion !== null && (
            <div className="sticky top-4">
              <DetalleTarea key={seleccion} id={seleccion} {...accionesDetalle} />
            </div>
          )}
        </div>
      )}

      {esCelular && (
        <PanelLateral abierto={elegida !== null && seleccion !== null} onCerrar={() => setElegida(null)} titulo="Tarea" cuerpoClassName="!p-0">
          {seleccion !== null && <DetalleTarea id={seleccion} sinMarco {...accionesDetalle} />}
        </PanelLateral>
      )}

      <ModalHecha tarea={haciendo} onCerrar={() => setHaciendo(null)} />
      <ModalReprogramar tarea={reprogramando} onCerrar={() => setReprogramando(null)} />
    </div>
  );
}

function FilaTarea({
  tarea,
  ahora,
  seleccionada,
  responsable,
  onElegir,
  onHecha
}: {
  tarea: Tarea;
  ahora: Date;
  seleccionada: boolean;
  responsable: string | null;
  onElegir: () => void;
  onHecha: () => void;
}) {
  const g = grupoDe(tarea, ahora);
  const abierta = tarea.estado === "pendiente" || tarea.estado === "en_progreso";
  const barras = BARRAS[tarea.prioridad];
  return (
    <div className={clsx("flex items-center gap-3 border-l-[3px] px-4 py-2.5", seleccionada ? "border-l-navy bg-navy-bg" : "border-l-transparent hover:bg-soft")}>
      {abierta ? (
        <button
          type="button"
          onClick={onHecha}
          aria-label={tarea.tipo === "clasificacion" ? "Clasificar en la cola" : "Marcar como hecha"}
          title={tarea.tipo === "clasificacion" ? "Clasificar en la cola" : "Marcar como hecha"}
          className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] border-2 border-ink-3/50 text-transparent hover:border-ok hover:text-ok"
        >
          <Icono nombre="check" size={11} strokeWidth={3.5} />
        </button>
      ) : (
        <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[6px] bg-ok-bg text-ok">
          <Icono nombre="check" size={11} strokeWidth={3.5} />
        </span>
      )}
      <button type="button" onClick={onElegir} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-current={seleccionada}>
        <span className="flex h-[14px] shrink-0 items-end gap-[2px]" title={`Prioridad ${ETIQUETA_PRIORIDAD[tarea.prioridad].toLowerCase()}`}>
          {[6, 10, 14].map((h, i) => (
            <i key={h} className={clsx("w-[3px] rounded-[1px]", i < barras.llenas ? barras.color : "bg-border")} style={{ height: h }} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className={clsx("block truncate text-[13.5px] font-bold", abierta ? "text-strong" : "text-ink-3 line-through")}>{tarea.titulo}</span>
          {tarea.empresa_nombre && <small className="block truncate text-[12px] text-ink-3">{tarea.empresa_nombre}</small>}
        </span>
        <span className={clsx("mono shrink-0 text-[12px] font-bold", COLOR_GRUPO[g])}>{abierta ? venceCorto(tarea.fecha_limite, ahora) : ""}</span>
        {responsable !== null && <Avatar nombre={responsable} />}
        {responsable === null && tarea.responsable_id === null && abierta && (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed border-ink-3/60 text-[10px] text-ink-3" title="Sin asignar">
            ?
          </span>
        )}
      </button>
    </div>
  );
}
