import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { CampanasTab } from "../components/prospectos/CampanasTab";
import { ImportacionesTab } from "../components/prospectos/ImportacionesTab";
import { MandarAutomatizacionModal, type ProspectoParaFila } from "../components/prospectos/MandarAutomatizacionModal";
import { NuevoProspectoForm } from "../components/prospectos/NuevoProspectoForm";
import { Button } from "../components/ui/Button";
import { CajaBusqueda } from "../components/ui/CajaBusqueda";
import { Contador } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { EstadoVacio } from "../components/ui/EstadoVacio";
import { ServerError, inputBaseClass } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { Modal } from "../components/ui/Modal";
import { LogoEmpresa } from "../components/ui/LogoEmpresa";
import { Paginacion } from "../components/ui/Paginacion";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Segmento } from "../components/ui/Segmento";
import { Pastilla } from "../components/ui/Pastilla";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useCampanas } from "../lib/campanas";
import { fechaUtc, formatoDiaMes, formatoFecha, formatoFechaHora } from "../lib/formato";
import { ETIQUETA_MEDIO, claseMedio } from "../lib/medios";
import { GRUPOS_EMBUDO, TONO_ESTADO_PROSPECTO, etiquetaEstadoProspecto, filtroEstado, sePuedeMandar, tonoScore, type GrupoEmbudo } from "../lib/prospectos";
import type { ConteosProspectos, DatosFila, Paginated, ProspectoDetalle, ProspectoFila } from "../types";

// Prospectos del rediseño (docs/diseno/prospectos.html): de dónde vienen,
// en qué van y quién falta por contactar. Tres pestañas: la lista (con el
// embudo por estado arriba), Importaciones y Campañas. El alta y el detalle
// salen en un panel lateral. ?tab=campanas|importaciones abre esa pestaña.
// Administrador y supervisor eligen prospectos y los mandan a la fila de
// automatización (botón "Mandar a automatización", 16-oct-2026).
type TabId = "prospectos" | "importaciones" | "campanas";
const TABS: TabId[] = ["prospectos", "importaciones", "campanas"];

export function ProspectosPage() {
  const { user } = useAuth();
  // Los mismos roles que el botón "Mandar a automatización" (prospectos.controller.ts).
  const puedeEditarCampanas = user?.rol === "administrador" || user?.rol === "supervisor";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t === searchParams.get("tab")) ?? "prospectos";
  const [creando, setCreando] = useState(false);
  // Recién creado: se abre su detalle (puede no caer en la página visible).
  // ?prospecto=ID (liga del buscador, 21-oct-2026): lo abre ya elegido,
  // también si la liga cambia con la pantalla ya abierta. Al cerrar se quita
  // de la dirección, para que la misma liga lo vuelva a abrir.
  const prospectoDeLaLiga = Number(searchParams.get("prospecto")) || null;
  const [abiertoId, setAbiertoId] = useState<number | null>(prospectoDeLaLiga);
  const [ligaVista, setLigaVista] = useState(prospectoDeLaLiga);
  if (prospectoDeLaLiga !== ligaVista) {
    setLigaVista(prospectoDeLaLiga);
    if (prospectoDeLaLiga !== null) setAbiertoId(prospectoDeLaLiga);
  }
  function cerrarDetalle() {
    setAbiertoId(null);
    if (searchParams.has("prospecto")) {
      const sinProspecto = new URLSearchParams(searchParams);
      sinProspecto.delete("prospecto");
      setSearchParams(sinProspecto, { replace: true });
    }
  }
  const [avisoNuevo, setAvisoNuevo] = useState<string | null>(null);
  // "Ver prospectos" de una campaña filtra la lista por esa campaña.
  const [campanaId, setCampanaId] = useState("");

  const { data: conteos } = useQuery({
    queryKey: ["prospectos", "conteos"],
    queryFn: () => api.get<ConteosProspectos>("/api/v1/prospectos/conteos")
  });
  const { data: campanas } = useCampanas();
  const enFila = conteos?.por_estado.find((p) => p.estado === "en_fila")?.cantidad ?? (conteos ? 0 : undefined);

  function irA(t: TabId) {
    setSearchParams(t === "prospectos" ? {} : { tab: t }, { replace: true });
  }

  return (
    <AppShell
      titulo="Prospectos"
      encabezado={
        <EncabezadoPagina
          titulo="Prospectos"
          subtitulo="De dónde vienen, en qué van y quién falta por contactar."
          acciones={
            <>
              <Segmento
                etiqueta="Secciones de Prospectos"
                valor={tab}
                onCambiar={irA}
                opciones={[
                  { id: "prospectos", texto: "Prospectos", cuenta: conteos?.total },
                  { id: "importaciones", texto: "Importaciones" },
                  { id: "campanas", texto: "Campañas", cuenta: campanas?.data.filter((c) => c.estado === "activa").length }
                ]}
              />
              <Button className="w-full md:w-auto" onClick={() => setCreando(true)}>
                + Nuevo prospecto
              </Button>
            </>
          }
        />
      }
    >
      {tab === "prospectos" && (
        <ListaProspectos
          conteos={conteos}
          enFila={enFila}
          puedeMandar={puedeEditarCampanas}
          campanaId={campanaId}
          setCampanaId={setCampanaId}
          onAbrir={(id) => {
            setAvisoNuevo(null);
            setAbiertoId(id);
          }}
          onNuevo={() => setCreando(true)}
          onImportar={() => irA("importaciones")}
        />
      )}
      {tab === "importaciones" && <ImportacionesTab />}
      {tab === "campanas" && (
        <CampanasTab
          puedeEditar={puedeEditarCampanas}
          onVerProspectos={(id) => {
            setCampanaId(String(id));
            irA("prospectos");
          }}
        />
      )}

      <PanelLateral
        abierto={creando}
        onCerrar={() => setCreando(false)}
        encabezado={
          <div>
            <h2 className="pt-1 font-heading text-[20px] font-black text-strong">Nuevo prospecto</h2>
            <p className="mt-1 text-[13px] text-ink-2">Lo esencial primero. Lo opcional se puede llenar después.</p>
          </div>
        }
        cuerpoClassName="!p-0"
      >
        <NuevoProspectoForm
          onDone={(id, aviso) => {
            setCreando(false);
            if (id) {
              setAvisoNuevo(aviso ?? null);
              setAbiertoId(id);
            }
          }}
        />
      </PanelLateral>

      <PanelLateral abierto={abiertoId !== null} onCerrar={cerrarDetalle} titulo="Prospecto">
        {abiertoId !== null && <DetalleProspecto id={abiertoId} aviso={avisoNuevo} puedeMandar={puedeEditarCampanas} enFila={enFila} />}
      </PanelLateral>
    </AppShell>
  );
}

// --- Lista ---------------------------------------------------------------------

const LIMIT = 25;
type Orden = "score" | "recientes" | "creado" | "fila";

// Lo que el modal del botón necesita de cada prospecto elegido.
function paraFila(p: ProspectoFila): ProspectoParaFila {
  return { id: p.id, contacto_nombre: p.contacto_nombre, empresa_nombre: p.empresa_nombre_legal, estado: p.estado, campana_id: p.campana_id, motivo_exclusion_anterior: p.motivo_exclusion_anterior };
}

// Casillas de la lista (solo administrador y supervisor). Los elegidos se
// guardan completos para que sigan elegidos al cambiar de página.
type Seleccion = { elegidos: Map<number, ProspectoFila>; onElegir: (filas: ProspectoFila[], elegir: boolean) => void };

function ListaProspectos({
  conteos,
  enFila,
  puedeMandar,
  campanaId,
  setCampanaId,
  onAbrir,
  onNuevo,
  onImportar
}: {
  conteos: ConteosProspectos | undefined;
  enFila: number | undefined;
  puedeMandar: boolean;
  campanaId: string;
  setCampanaId: (v: string) => void;
  onAbrir: (id: number) => void;
  onNuevo: () => void;
  onImportar: () => void;
}) {
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [estado, setEstado] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [orden, setOrden] = useState<Orden>("score");
  const [page, setPage] = useState(1);
  const { data: campanas } = useCampanas();
  const [elegidos, setElegidos] = useState<Map<number, ProspectoFila>>(new Map());
  // Copia de los elegidos al abrir el modal: al terminar se limpia la
  // selección y el resumen sigue necesitando sus nombres.
  const [mandando, setMandando] = useState<ProspectoParaFila[] | null>(null);

  function onElegir(filas: ProspectoFila[], elegir: boolean) {
    setElegidos((antes) => {
      const nuevos = new Map(antes);
      for (const p of filas) {
        if (elegir) nuevos.set(p.id, p);
        else nuevos.delete(p.id);
      }
      return nuevos;
    });
  }
  const seleccion: Seleccion | undefined = puedeMandar ? { elegidos, onElegir } : undefined;

  const filtros = { q: busqueda || undefined, ...filtroEstado(estado), prioridad: prioridad || undefined, campanaId: campanaId || undefined, orden, page, limit: LIMIT };
  // Un agente solo ve prospectos de sus empresas (ProspectosService.listProspectos).
  const { data, isPending, isError } = useQuery({
    queryKey: ["prospectos", filtros],
    queryFn: () => api.get<Paginated<ProspectoFila>>("/api/v1/prospectos", filtros)
  });
  const hayFiltros = Boolean(busqueda || estado || prioridad || campanaId);
  const nombreCampana = campanas?.data.find((c) => String(c.id) === campanaId)?.nombre;

  function cambiar(fn: () => void) {
    setPage(1);
    fn();
  }

  // La búsqueda se aplica sola al dejar de escribir, como en Documentos,
  // Tareas, Oportunidades y Cotizaciones (15-oct-2026); Enter la aplica de una vez.
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim() !== busqueda) cambiar(() => setBusqueda(q.trim()));
    }, 300);
    return () => clearTimeout(t);
  }, [q, busqueda]);

  return (
    <div className="flex flex-col gap-3.5">
      <Embudo conteos={conteos} estado={estado} onEstado={(e) => cambiar(() => setEstado(e === estado ? "" : e))} />

      <form
        className="flex flex-wrap items-center gap-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          cambiar(() => setBusqueda(q.trim()));
        }}
      >
        <CajaBusqueda placeholder="Buscar por empresa o contacto…" valor={q} onCambiar={setQ} />
        <select aria-label="Estado" className={`${inputBaseClass} h-10 w-auto`} value={estado} onChange={(e) => cambiar(() => setEstado(e.target.value))}>
          <option value="">Estado: Todos</option>
          {GRUPOS_EMBUDO.flatMap((g) => g.estados ?? []).map((e) => (
            <option key={e} value={e}>
              {etiquetaEstadoProspecto(e)}
            </option>
          ))}
        </select>
        <select aria-label="Prioridad" className={`${inputBaseClass} h-10 w-auto`} value={prioridad} onChange={(e) => cambiar(() => setPrioridad(e.target.value))}>
          <option value="">Prioridad: Todas</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        <select aria-label="Campaña" className={`${inputBaseClass} h-10 w-auto max-w-[220px]`} value={campanaId} onChange={(e) => cambiar(() => setCampanaId(e.target.value))}>
          <option value="">Campaña: Todas</option>
          {(campanas?.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
        <select aria-label="Ordenar" className={`${inputBaseClass} h-10 w-auto md:ml-auto`} value={orden} onChange={(e) => cambiar(() => setOrden(e.target.value as Orden))}>
          <option value="score">Ordenar: Score</option>
          <option value="recientes">Ordenar: Más recientes</option>
          <option value="creado">Ordenar: Más antiguos</option>
          <option value="fila">Ordenar: Fila de automatización</option>
        </select>
      </form>

      {elegidos.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-navy/30 bg-card px-4 py-2.5 shadow-[0_10px_24px_-16px_rgba(0,0,0,0.5)]">
          <span className="text-[13px] font-bold text-strong">{elegidos.size === 1 ? "1 elegido" : `${elegidos.size} elegidos`}</span>
          <Button variant="ghost" className="!px-2.5 !py-1.5 text-[12.5px]" onClick={() => setElegidos(new Map())}>
            Quitar selección
          </Button>
          <Button className="ml-auto" onClick={() => setMandando([...elegidos.values()].map(paraFila))}>
            Mandar a automatización ({elegidos.size})
          </Button>
        </div>
      )}

      <section className="tarjeta-blanca overflow-hidden">
        {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar los prospectos.</div>}
        {data && data.data.length === 0 && hayFiltros && (
          <div className="p-5 text-sm text-ink-3">
            No hay prospectos con ese filtro{nombreCampana ? ` (campaña «${nombreCampana}»)` : ""}.
          </div>
        )}
        {data && data.data.length === 0 && !hayFiltros && page === 1 && (
          <EstadoVacio
            className="p-5"
            titulo="Todavía no hay prospectos confirmados."
            texto="Importa un CSV y confirma sus filas, o da de alta uno con + Nuevo prospecto."
            accion={
              <div className="flex gap-2">
                <Button variant="outline" onClick={onImportar}>
                  Importar CSV
                </Button>
                <Button variant="ghost" className="border border-border" onClick={onNuevo}>
                  Nuevo prospecto
                </Button>
              </div>
            }
          />
        )}
        {data && data.data.length > 0 && <TablaProspectos filas={data.data} onAbrir={onAbrir} seleccion={seleccion} />}
        {data && (page > 1 || data.data.length === LIMIT) && (
          <div className="border-t border-border bg-soft">
            <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />
          </div>
        )}
      </section>

      {mandando && (
        <MandarAutomatizacionModal
          prospectos={mandando}
          enFila={enFila}
          onCerrar={() => setMandando(null)}
          onEnviado={() => setElegidos(new Map())}
        />
      )}
    </div>
  );
}

// Tarjetas del embudo. Las de un solo estado filtran la lista al dar clic;
// las que juntan varios abren el filtro con el primero (el selector de
// Estado deja elegir los demás).
function Embudo({ conteos, estado, onEstado }: { conteos: ConteosProspectos | undefined; estado: string; onEstado: (e: string) => void }) {
  const cuenta = (estados: string[]) => estados.reduce((s, e) => s + (conteos?.por_estado.find((p) => p.estado === e)?.cantidad ?? 0), 0);
  // Antes del backend del 15-oct no llega en_campana: se cae a contactados
  // (y Validados incluye a los que ya están en campaña).
  const enCampana = conteos?.en_campana;
  const valor = (g: GrupoEmbudo) => {
    if (!conteos) return "…";
    if (g.id === "en_campana") return enCampana ?? conteos.contactados;
    if (g.id === "validados") return cuenta(["validado"]) - (enCampana ?? 0);
    return cuenta(g.estados ?? []);
  };
  const detalle = (g: GrupoEmbudo) => {
    if (g.id === "respondieron") {
      const n = cuenta(["interesado"]);
      return `${n} ${n === 1 ? "interesado" : "interesados"}`;
    }
    return g.detalle;
  };
  const principales = GRUPOS_EMBUDO.filter((g) => !g.aparte);
  const aparte = GRUPOS_EMBUDO.filter((g) => g.aparte);
  const tarjeta = (g: GrupoEmbudo) => {
    const filtra = g.estados?.length === 1;
    return (
      <Contador
        key={g.id}
        etiqueta={g.etiqueta}
        valor={valor(g)}
        detalle={detalle(g)}
        tono={g.tono}
        seleccionado={Boolean(g.estados?.includes(estado))}
        onClick={filtra ? () => onEstado(g.estados![0]) : undefined}
      />
    );
  };
  // Cinco principales desde "En fila" (16-oct-2026): con el menú lateral no
  // caben cinco en tablet, así que ahí van de dos en dos (la última a lo
  // ancho) y en una sola fila desde lg. Excluidos y Baja van en su propia
  // fila hasta xl, donde se juntan con las demás tras la rayita.
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5 xl:grid-cols-[repeat(5,minmax(0,1fr))_1px_repeat(2,minmax(0,0.8fr))]">
      {principales.map((g, i) => (
        <div key={g.id} className={clsx("[&>*]:h-full", i === principales.length - 1 && principales.length % 2 === 1 && "col-span-2 lg:col-span-1")}>
          {tarjeta(g)}
        </div>
      ))}
      <span aria-hidden="true" className="hidden self-center bg-border xl:block xl:h-[70%]" />
      <div className="col-span-2 grid grid-cols-2 gap-2.5 lg:col-span-5 xl:contents">
        {aparte.map((g) => (
          <div key={g.id} className="[&>*]:h-full">
            {tarjeta(g)}
          </div>
        ))}
      </div>
    </div>
  );
}

function TablaProspectos({ filas, onAbrir, seleccion }: { filas: ProspectoFila[]; onAbrir: (id: number) => void; seleccion?: Seleccion }) {
  return (
    <>
      <ListaCelular filas={filas} onAbrir={onAbrir} seleccion={seleccion} />
      <TablaEscritorio filas={filas} onAbrir={onAbrir} seleccion={seleccion} />
    </>
  );
}

// Casilla de un prospecto. Solo se pueden elegir los que el botón acepta
// (capturado, excluido, o en la fila sin tomar para cambiarle la campaña).
function Casilla({ p, seleccion }: { p: ProspectoFila; seleccion: Seleccion }) {
  const puede = sePuedeMandar(p);
  return (
    <input
      type="checkbox"
      aria-label={`Elegir a ${p.contacto_nombre}`}
      title={puede ? undefined : "Solo se mandan a automatización los capturados y los excluidos"}
      disabled={!puede}
      checked={seleccion.elegidos.has(p.id)}
      onChange={(e) => seleccion.onElegir([p], e.target.checked)}
      onClick={(e) => e.stopPropagation()}
      className="h-4 w-4 shrink-0 cursor-pointer accent-navy disabled:cursor-not-allowed disabled:opacity-30"
    />
  );
}

// Celular (diseño, max-width 760px): tarjeta compacta, empresa y score
// arriba, contacto y estado abajo, y la barrita de correos.
function ListaCelular({ filas, onAbrir, seleccion }: { filas: ProspectoFila[]; onAbrir: (id: number) => void; seleccion?: Seleccion }) {
  return (
    <ul className="divide-y divide-border md:hidden">
      {filas.map((p) => (
        <li key={p.id} className="flex items-center">
          {seleccion && (
            <label className="grid self-stretch place-items-center pl-3.5">
              <Casilla p={p} seleccion={seleccion} />
            </label>
          )}
          <button type="button" onClick={() => onAbrir(p.id)} className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 text-left active:bg-soft">
            <div className="flex min-w-0 items-center gap-3">
              <LogoEmpresa id={p.empresa_id} nombre={p.empresa_nombre_legal} />
              <div className="min-w-0">
                <b className="block truncate text-[14px] text-strong">{p.empresa_nombre_legal}</b>
                <small className="block truncate text-[12px] text-ink-3">{[p.empresa_giro, p.empresa_estado].filter(Boolean).join(" · ") || "Sin giro"}</small>
              </div>
            </div>
            <Anillo score={p.score} />
            <div className="min-w-0">
              <b className="block truncate text-[13px] font-bold text-ink">{p.contacto_nombre}</b>
              <Pasos envios={p.envios} ultimo={p.ultimo_envio_en} />
            </div>
            <span className="justify-self-end">
              <EstadoProspecto fila={p} />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TablaEscritorio({ filas, onAbrir, seleccion }: { filas: ProspectoFila[]; onAbrir: (id: number) => void; seleccion?: Seleccion }) {
  const elegibles = filas.filter(sePuedeMandar);
  const todos = elegibles.length > 0 && elegibles.every((p) => seleccion?.elegidos.has(p.id));
  return (
    <div className="tabla-scroll hidden md:block">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-soft">
            {seleccion && (
              <th className="w-10 py-3 pl-[18px]">
                <input
                  type="checkbox"
                  aria-label="Elegir todos los de esta página"
                  disabled={elegibles.length === 0}
                  checked={todos}
                  onChange={(e) => seleccion.onElegir(elegibles, e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-navy disabled:cursor-not-allowed disabled:opacity-30"
                />
              </th>
            )}
            {["Empresa", "Contacto", "Estado", "Correos", "Score", "Prioridad"].map((h) => (
              <th key={h} className="px-4 py-3 text-left font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3 first:pl-[18px]">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((p) => (
            <tr key={p.id} tabIndex={0} onClick={() => onAbrir(p.id)} onKeyDown={(e) => e.key === "Enter" && onAbrir(p.id)} className="cursor-pointer border-t border-border hover:bg-soft">
              {seleccion && (
                <td className="py-3 pl-[18px]" onClick={(e) => e.stopPropagation()}>
                  <Casilla p={p} seleccion={seleccion} />
                </td>
              )}
              <td className={clsx("px-4 py-3", !seleccion && "pl-[18px]")}>
                <div className="flex min-w-0 items-center gap-3">
                  <LogoEmpresa id={p.empresa_id} nombre={p.empresa_nombre_legal} />
                  <div className="min-w-0">
                    <b className="block truncate text-[14px] text-strong">{p.empresa_nombre_legal}</b>
                    <small className="block truncate text-[12px] text-ink-3">{[p.empresa_giro, p.empresa_estado].filter(Boolean).join(" · ") || "Sin giro"}</small>
                  </div>
                </div>
              </td>
              <td data-label="Contacto" className="px-4 py-3">
                <b className="block truncate text-[13px] font-bold text-ink">{p.contacto_nombre}</b>
                <small className="block truncate text-[12px] text-ink-3">{p.contacto_puesto ?? "—"}</small>
              </td>
              <td data-label="Estado" className="px-4 py-3">
                <EstadoProspecto fila={p} />
              </td>
              <td data-label="Correos" className="px-4 py-3">
                <Pasos envios={p.envios} ultimo={p.ultimo_envio_en} />
              </td>
              <td data-label="Score" className="px-4 py-3">
                <Anillo score={p.score} />
              </td>
              <td data-label="Prioridad" className="px-4 py-3 text-[12px] font-bold capitalize">
                <span className={p.prioridad === "alta" ? "text-strong" : p.prioridad === "media" ? "text-ink-2" : "text-ink-3"}>{p.prioridad ?? "—"}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// "En campaña" no es un estado guardado: un validado que ya recibió correo.
// En la fila: abajo de la pastilla, desde cuándo y su lugar.
function EstadoProspecto({ fila }: { fila: Pick<ProspectoFila, "estado" | "envios"> & DatosFila }) {
  return (
    <span className="inline-flex flex-col items-end gap-1 md:items-start">
      <PastillaEstado fila={fila} />
      <LineaFila fila={fila} />
    </span>
  );
}

function PastillaEstado({ fila }: { fila: Pick<ProspectoFila, "estado" | "envios"> }) {
  if (fila.estado === "validado" && fila.envios > 0) {
    return (
      <Pastilla tono="navy" punto>
        En campaña
      </Pastilla>
    );
  }
  return (
    <Pastilla tono={TONO_ESTADO_PROSPECTO[fila.estado] ?? "neutro"} punto>
      {etiquetaEstadoProspecto(fila.estado)}
    </Pastilla>
  );
}

// Cómo va en la fila de automatización (null si no está en ella). Una
// campaña en espera (pausada o que aún no empieza) solo detiene su salida;
// una terminada (inactiva) necesita que alguien lo cambie de campaña o lo saque.
function textoFila(fila: DatosFila & { estado: string }): { texto: string; alerta: boolean } | null {
  if (fila.estado !== "en_fila") return null;
  if (fila.fila_tomado_en) return { texto: "Ya lo tomó la automatización", alerta: false };
  if (fila.campana_vigencia === "inactiva") return { texto: "Campaña terminada", alerta: true };
  if (fila.campana_vigencia === "en_espera") return { texto: "Esperando a la campaña", alerta: false };
  const desde = fila.fila_desde ? `Desde ${formatoDiaMes.format(fechaUtc(fila.fila_desde))}` : null;
  return { texto: [desde, fila.fila_posicion && `lugar ${fila.fila_posicion}`].filter(Boolean).join(" · "), alerta: false };
}

function LineaFila({ fila }: { fila: DatosFila & { estado: string } }) {
  const t = textoFila(fila);
  if (!t?.texto) return null;
  return <small className={clsx("whitespace-nowrap text-[11.5px]", t.alerta ? "font-bold text-danger" : "text-ink-3")}>{t.texto}</small>;
}

// Barrita de los 3 correos de la secuencia (inicial + 2 recordatorios).
function Pasos({ envios, ultimo }: { envios: number; ultimo: string | null }) {
  const hechos = Math.min(envios, 3);
  return (
    <span className="inline-flex items-center gap-1" title={ultimo ? `Último correo: ${formatoFechaHora.format(fechaUtc(ultimo))}` : "Sin correos todavía"}>
      {[0, 1, 2].map((i) => (
        <i key={i} className={clsx("h-1.5 w-[22px] rounded-full", i < hechos ? "bg-[linear-gradient(90deg,var(--mint),var(--cyan))]" : "bg-border")} />
      ))}
      <span className="mono ml-1.5 whitespace-nowrap text-[11px] text-ink-3">{envios}/3</span>
    </span>
  );
}

function Anillo({ score }: { score: string | null }) {
  if (score == null) {
    return <span className="text-[13px] text-ink-3">—</span>;
  }
  const n = Math.round(Number(score));
  const tono = tonoScore(n);
  const color = tono === "ok" ? "var(--ok)" : tono === "warn" ? "var(--warn)" : "var(--danger)";
  return (
    <span className="grid h-[38px] w-[38px] place-items-center rounded-full" style={{ background: `conic-gradient(${color} ${n}%, var(--soft) 0)` }} aria-label={`Score ${n} de 100`}>
      <span className="mono grid h-[30px] w-[30px] place-items-center rounded-full bg-card text-[11px] font-extrabold text-strong">{n}</span>
    </span>
  );
}

// --- Detalle (panel lateral) -------------------------------------------------------

function DetalleProspecto({ id, aviso, puedeMandar, enFila }: { id: number; aviso: string | null; puedeMandar: boolean; enFila: number | undefined }) {
  const { data: p, isPending, isError } = useQuery({
    queryKey: ["prospecto", id],
    queryFn: () => api.get<ProspectoDetalle>(`/api/v1/prospectos/${id}`)
  });
  const { data: campanas } = useCampanas();
  const campana = campanas?.data.find((c) => c.id === p?.campana_id);

  if (isPending) return <div className="text-sm text-ink-2">Cargando…</div>;
  if (isError || !p) return <div className="text-sm text-danger">No se pudo cargar el prospecto.</div>;

  return (
    <div className="flex flex-col gap-5">
      {aviso !== null && (
        <div className="flex flex-col gap-2">
          <div className="rounded-[10px] bg-ok-bg px-3.5 py-2.5 text-[13px] text-ok">Prospecto creado.</div>
          {aviso && <div className="rounded-[10px] bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn">{aviso}</div>}
        </div>
      )}
      <div className="flex items-start gap-3">
        <LogoEmpresa id={p.empresa.id} nombre={p.empresa.nombre_legal} tamano="grande" />
        <div className="min-w-0">
          <h3 className="font-heading text-[18px] font-extrabold text-strong">{p.contacto.nombre}</h3>
          <p className="text-[13px] text-ink-2">{[p.contacto.puesto, p.empresa.nombre_legal].filter(Boolean).join(" · ")}</p>
          <div className="mt-2">
            <Pastilla tono={TONO_ESTADO_PROSPECTO[p.estado] ?? "neutro"} punto>
              {etiquetaEstadoProspecto(p.estado)}
            </Pastilla>
          </div>
        </div>
      </div>

      <AutomatizacionDetalle p={p} puedeMandar={puedeMandar} enFila={enFila} />

      <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 rounded-[14px] border border-border bg-soft p-4 text-[13px]">
        <Dato etiqueta="Prioridad">{p.prioridad ?? "—"}</Dato>
        <Dato etiqueta="Confianza">{p.confianza ?? "—"}</Dato>
        <Dato etiqueta="Score">{p.score != null ? Math.round(Number(p.score)) : "—"}</Dato>
        <Dato etiqueta="Campaña">{p.campana_id != null ? (campana?.nombre ?? `#${p.campana_id}`) : "—"}</Dato>
        <Dato etiqueta="Fuente">
          {p.fuente_url ? (
            <a href={p.fuente_url} target="_blank" rel="noopener noreferrer" className="break-all font-semibold text-navy hover:underline">
              {p.fuente_url}
            </a>
          ) : (
            "—"
          )}
        </Dato>
        <Dato etiqueta="Alta">{formatoFecha.format(new Date(p.creado_en))}</Dato>
      </dl>

      <div>
        <div className="mb-2 font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3">Medios de contacto</div>
        <div className="flex flex-wrap gap-1.5">
          {p.contacto.medios.map((m) => (
            <span key={`${m.tipo}:${m.valor}`} className={`max-w-full break-all rounded-full px-2.5 py-1 text-[11px] font-semibold ${claseMedio(m.estado_contacto)}`}>
              {ETIQUETA_MEDIO[m.tipo] ?? m.tipo}: {m.valor}
              {m.estado_contacto === "no_contactar" && " (no contactar)"}
            </span>
          ))}
          {p.contacto.medios.length === 0 && <span className="text-sm text-ink-3">Sin medios registrados.</span>}
        </div>
      </div>

      <Link to={`/empresas/${p.empresa.id}`} className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-card px-4 py-2.5 text-[13.5px] font-extrabold text-strong hover:border-navy/40">
        Ver ficha de la empresa <Icono nombre="flechaDerecha" size={15} />
      </Link>
    </div>
  );
}

// La fila de automatización en el detalle: dónde va y, para administrador y
// supervisor, mandarlo, cambiarle la campaña o sacarlo (mientras PT1 no lo
// haya tomado; al sacarlo vuelve a Capturado y pierde su lugar).
function AutomatizacionDetalle({ p, puedeMandar, enFila }: { p: ProspectoDetalle; puedeMandar: boolean; enFila: number | undefined }) {
  const queryClient = useQueryClient();
  const [mandando, setMandando] = useState(false);
  const [confirmarSacar, setConfirmarSacar] = useState(false);
  const [sacando, setSacando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enLaFila = p.estado === "en_fila";
  const fila = textoFila(p);
  const puede = puedeMandar && sePuedeMandar(p);
  if (!enLaFila && !puede) return null;

  async function sacar() {
    setError(null);
    setSacando(true);
    try {
      await api.post(`/api/v1/prospectos/${p.id}/sacar-de-fila`, {});
      setConfirmarSacar(false);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["prospectos"] }), queryClient.invalidateQueries({ queryKey: ["prospecto", p.id] })]);
    } catch (e) {
      // 409 PROSPECTO_YA_TOMADO: PT1 lo tomó mientras tanto.
      setConfirmarSacar(false);
      setError(e instanceof ApiError ? e.message : "No se pudo conectar con el servidor");
    } finally {
      setSacando(false);
    }
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] border border-border p-4">
      <div className="font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3">Automatización</div>
      {enLaFila ? (
        <p className="text-[13px] text-strong">
          {fila?.alerta ? (
            <span className="font-bold text-danger">La campaña ya terminó: cámbialo de campaña o sácalo de la fila.</span>
          ) : p.fila_tomado_en ? (
            `La automatización ya lo tomó (${formatoFechaHora.format(fechaUtc(p.fila_tomado_en))}); ya va de salida.`
          ) : p.campana_vigencia === "en_espera" ? (
            "Está en la fila esperando a que su campaña empiece o se reanude."
          ) : (
            `En la fila${p.fila_desde ? ` desde el ${formatoFecha.format(fechaUtc(p.fila_desde))}` : ""}${p.fila_posicion ? `, lugar ${p.fila_posicion}` : ""}. Sale solo.`
          )}
        </p>
      ) : (
        <p className="text-[13px] text-ink-2">Todavía no recibe correos. Al mandarlo a automatización entra a la fila y sale solo, unos 6 a 10 por día hábil.</p>
      )}
      <ServerError message={error} />
      {puede && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMandando(true)}>{enLaFila ? "Cambiar de campaña" : "Mandar a automatización"}</Button>
          {enLaFila && (
            <Button variant="peligro" onClick={() => setConfirmarSacar(true)}>
              Sacar de la fila
            </Button>
          )}
        </div>
      )}

      {mandando && (
        <MandarAutomatizacionModal
          prospectos={[{ id: p.id, contacto_nombre: p.contacto.nombre, empresa_nombre: p.empresa.nombre_legal, estado: p.estado, campana_id: p.campana_id, motivo_exclusion_anterior: p.motivo_exclusion_anterior }]}
          enFila={enFila}
          onCerrar={() => setMandando(false)}
        />
      )}
      <Modal
        abierto={confirmarSacar}
        onCerrar={() => !sacando && setConfirmarSacar(false)}
        titulo="¿Sacar de la fila?"
        descripcion="Vuelve a Capturado y pierde su lugar en la fila. La campaña se queda como está."
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmarSacar(false)} disabled={sacando}>
              No, dejarlo
            </Button>
            <Button variant="rechazar" onClick={() => void sacar()} disabled={sacando}>
              Sí, sacarlo
            </Button>
          </>
        }
      />
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{etiqueta}</dt>
      <dd className="min-w-0 text-strong">{children}</dd>
    </>
  );
}

