import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { CampanasTab } from "../components/prospectos/CampanasTab";
import { ImportacionesTab } from "../components/prospectos/ImportacionesTab";
import { NuevoProspectoForm } from "../components/prospectos/NuevoProspectoForm";
import { Button } from "../components/ui/Button";
import { Contador } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { EstadoVacio } from "../components/ui/EstadoVacio";
import { Ficha } from "../components/ui/Ficha";
import { inputBaseClass } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { Paginacion } from "../components/ui/Paginacion";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Segmento } from "../components/ui/Segmento";
import { Pastilla } from "../components/ui/Pastilla";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useCampanas } from "../lib/campanas";
import { fechaUtc, formatoFecha, formatoFechaHora } from "../lib/formato";
import { ETIQUETA_MEDIO, claseMedio } from "../lib/medios";
import { GRUPOS_EMBUDO, TONO_ESTADO_PROSPECTO, colorLogo, etiquetaEstadoProspecto, iniciales, tonoScore, type GrupoEmbudo } from "../lib/prospectos";
import type { ConteosProspectos, Paginated, ProspectoDetalle, ProspectoFila } from "../types";

// Prospectos del rediseño (docs/diseno/prospectos.html): de dónde vienen,
// en qué van y quién falta por contactar. Tres pestañas: la lista (con el
// embudo por estado arriba), Importaciones y Campañas. El alta y el detalle
// salen en un panel lateral. ?tab=campanas|importaciones abre esa pestaña.
type TabId = "prospectos" | "importaciones" | "campanas";
const TABS: TabId[] = ["prospectos", "importaciones", "campanas"];

export function ProspectosPage() {
  const { user } = useAuth();
  const puedeEditarCampanas = user?.rol === "administrador" || user?.rol === "supervisor";
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t === searchParams.get("tab")) ?? "prospectos";
  const [creando, setCreando] = useState(false);
  // Recién creado: se abre su detalle (puede no caer en la página visible).
  const [abiertoId, setAbiertoId] = useState<number | null>(null);
  const [avisoNuevo, setAvisoNuevo] = useState<string | null>(null);
  // "Ver prospectos" de una campaña filtra la lista por esa campaña.
  const [campanaId, setCampanaId] = useState("");

  const { data: conteos } = useQuery({
    queryKey: ["prospectos", "conteos"],
    queryFn: () => api.get<ConteosProspectos>("/api/v1/prospectos/conteos")
  });
  const { data: campanas } = useCampanas();

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

      <PanelLateral abierto={abiertoId !== null} onCerrar={() => setAbiertoId(null)} titulo="Prospecto">
        {abiertoId !== null && <DetalleProspecto id={abiertoId} aviso={avisoNuevo} />}
      </PanelLateral>
    </AppShell>
  );
}

// --- Lista ---------------------------------------------------------------------

const LIMIT = 25;
type Orden = "score" | "recientes" | "creado";

function ListaProspectos({
  conteos,
  campanaId,
  setCampanaId,
  onAbrir,
  onNuevo,
  onImportar
}: {
  conteos: ConteosProspectos | undefined;
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

  const filtros = { q: busqueda || undefined, estado: estado || undefined, prioridad: prioridad || undefined, campanaId: campanaId || undefined, orden, page, limit: LIMIT };
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
        <label className="flex h-10 min-w-0 flex-[1_1_100%] items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-ink-3 md:max-w-[420px] md:flex-[1_1_260px]">
          <Icono nombre="buscar" size={15} />
          <input
            aria-label="Buscar"
            placeholder="Buscar por empresa o contacto…"
            className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-strong outline-none placeholder:text-ink-3"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => q.trim() !== busqueda && cambiar(() => setBusqueda(q.trim()))}
          />
        </label>
        {estado && (
          <Ficha activa onClick={() => cambiar(() => setEstado(""))}>
            Estado: {etiquetaEstadoProspecto(estado)} ✕
          </Ficha>
        )}
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
        </select>
      </form>

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
        {data && data.data.length > 0 && <TablaProspectos filas={data.data} onAbrir={onAbrir} />}
        {data && (page > 1 || data.data.length === LIMIT) && (
          <div className="border-t border-border bg-soft">
            <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />
          </div>
        )}
      </section>
    </div>
  );
}

// Tarjetas del embudo. Las de un solo estado filtran la lista al dar clic;
// las que juntan varios abren el filtro con el primero (el selector de
// Estado deja elegir los demás).
function Embudo({ conteos, estado, onEstado }: { conteos: ConteosProspectos | undefined; estado: string; onEstado: (e: string) => void }) {
  const cuenta = (estados: string[]) => estados.reduce((s, e) => s + (conteos?.por_estado.find((p) => p.estado === e)?.cantidad ?? 0), 0);
  const valor = (g: GrupoEmbudo) => (conteos ? (g.estados ? cuenta(g.estados) : conteos.contactados) : "…");
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
  return (
    <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-[repeat(4,minmax(0,1fr))_1px_repeat(2,minmax(0,0.8fr))]">
      {principales.map(tarjeta)}
      <span aria-hidden="true" className="hidden self-center bg-border xl:block xl:h-[70%]" />
      {aparte.map((g) => (
        <div key={g.id} className="md:col-span-2 xl:col-span-1 [&>*]:h-full">
          {tarjeta(g)}
        </div>
      ))}
    </div>
  );
}

function TablaProspectos({ filas, onAbrir }: { filas: ProspectoFila[]; onAbrir: (id: number) => void }) {
  return (
    <>
      <ListaCelular filas={filas} onAbrir={onAbrir} />
      <TablaEscritorio filas={filas} onAbrir={onAbrir} />
    </>
  );
}

// Celular (diseño, max-width 760px): tarjeta compacta, empresa y score
// arriba, contacto y estado abajo, y la barrita de correos.
function ListaCelular({ filas, onAbrir }: { filas: ProspectoFila[]; onAbrir: (id: number) => void }) {
  return (
    <ul className="divide-y divide-border md:hidden">
      {filas.map((p) => (
        <li key={p.id}>
          <button type="button" onClick={() => onAbrir(p.id)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 text-left active:bg-soft">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] font-heading text-[13px] font-extrabold text-white" style={{ background: colorLogo(p.empresa_id) }}>
                {iniciales(p.empresa_nombre_legal)}
              </span>
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

function TablaEscritorio({ filas, onAbrir }: { filas: ProspectoFila[]; onAbrir: (id: number) => void }) {
  return (
    <div className="tabla-scroll hidden md:block">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-soft">
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
              <td className="px-4 py-3 pl-[18px]">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] font-heading text-[13px] font-extrabold text-white" style={{ background: colorLogo(p.empresa_id) }}>
                    {iniciales(p.empresa_nombre_legal)}
                  </span>
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
function EstadoProspecto({ fila }: { fila: Pick<ProspectoFila, "estado" | "envios"> }) {
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

function DetalleProspecto({ id, aviso }: { id: number; aviso: string | null }) {
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
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[13px] font-heading text-[15px] font-extrabold text-white" style={{ background: colorLogo(p.empresa.id) }}>
          {iniciales(p.empresa.nombre_legal)}
        </span>
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

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{etiqueta}</dt>
      <dd className="min-w-0 text-strong">{children}</dd>
    </>
  );
}

