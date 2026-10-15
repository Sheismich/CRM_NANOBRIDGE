import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { EmpresaForm } from "../components/empresas/EmpresaForm";
import { Avatar } from "../components/ui/Avatar";
import { Button } from "../components/ui/Button";
import { CajaBusqueda } from "../components/ui/CajaBusqueda";
import { Contador } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { EstadoVacio } from "../components/ui/EstadoVacio";
import { inputBaseClass } from "../components/ui/Field";
import { LogoEmpresa } from "../components/ui/LogoEmpresa";
import { MarcaDeAgua } from "../components/ui/MarcaDeAgua";
import { Paginacion } from "../components/ui/Paginacion";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { Segmento } from "../components/ui/Segmento";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { actividadVieja, fechaCorta, prospeccionEmpresa, textoUltimaActividad } from "../lib/empresas";
import { formatoMonedaEntera } from "../lib/formato";
import type { ConteosEmpresas, EmpresaFila, Paginated, Usuario } from "../types";

// Empresas del rediseño (docs/diseno/empresas.html, opción A): contadores,
// filtros, y la lista o las tarjetas. Con quién estamos hablando, quién la
// lleva y cuándo fue lo último. Un agente solo ve las suyas (lo decide el
// backend), así que para él no hay filtro de responsable.

const LIMIT = 25;
type Vista = "lista" | "tarjetas";
type Orden = "actividad" | "nombre";
const CLAVE_VISTA = "crm-empresas-vista";

function vistaGuardada(): Vista {
  try {
    return localStorage.getItem(CLAVE_VISTA) === "tarjetas" ? "tarjetas" : "lista";
  } catch {
    return "lista";
  }
}

export function EmpresasListPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  const [creando, setCreando] = useState(false);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [giro, setGiro] = useState("");
  const [region, setRegion] = useState("");
  // "" = todos, "sin" = sin responsable, o el id de la persona.
  const [responsable, setResponsable] = useState("");
  const [orden, setOrden] = useState<Orden>("actividad");
  const [vista, setVistaEstado] = useState<Vista>(vistaGuardada);

  function setVista(v: Vista) {
    setVistaEstado(v);
    try {
      localStorage.setItem(CLAVE_VISTA, v);
    } catch {
      // Sin almacenamiento: dura hasta recargar.
    }
  }
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

  const filtros = {
    page,
    limit: LIMIT,
    q: busqueda || undefined,
    giro: giro || undefined,
    region: region || undefined,
    responsableId: responsable && responsable !== "sin" ? responsable : undefined,
    sinResponsable: responsable === "sin" ? "true" : undefined,
    orden
  };
  const { data, isPending, isError } = useQuery({
    queryKey: ["empresas", filtros],
    queryFn: () => api.get<Paginated<EmpresaFila>>("/api/v1/empresas", filtros)
  });
  const { data: conteos } = useQuery({
    queryKey: ["empresas", "conteos"],
    queryFn: () => api.get<ConteosEmpresas>("/api/v1/empresas/conteos")
  });
  // Giro y región son texto libre (no hay catálogo): las opciones salen de
  // las primeras 100 empresas.
  const { data: muestra } = useQuery({
    queryKey: ["empresas", "opciones-filtro"],
    queryFn: () => api.get<Paginated<EmpresaFila>>("/api/v1/empresas", { limit: 100 }),
    staleTime: 5 * 60_000
  });
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor
  });
  const giros = distintos(muestra?.data.map((e) => e.giro));
  const regiones = distintos(muestra?.data.map((e) => e.region));
  const hayFiltros = Boolean(busqueda || giro || region || responsable);

  return (
    <AppShell
      titulo="Empresas"
      encabezado={
        <EncabezadoPagina
          titulo="Empresas"
          subtitulo="Con quién estamos hablando, quién la lleva y cuándo fue lo último."
          acciones={
            <Button className="w-full md:w-auto" onClick={() => setCreando(true)}>
              + Nueva empresa
            </Button>
          }
        />
      }
    >
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
          <Contador etiqueta="Total" valor={conteos?.total ?? "…"} detalle="empresas activas" tono="navy" seleccionado={!responsable} onClick={() => cambiar(() => setResponsable(""))} />
          <Contador
            etiqueta="Sin asignar"
            valor={conteos?.sin_responsable ?? "…"}
            detalle="nadie las lleva"
            tono="warn"
            seleccionado={responsable === "sin"}
            onClick={esAdminOSupervisor ? () => cambiar(() => setResponsable(responsable === "sin" ? "" : "sin")) : undefined}
          />
          <Contador etiqueta="Sin actividad" valor={conteos?.sin_actividad_30_dias ?? "…"} detalle="más de 30 días o nunca" tono="danger" />
          <Contador
            etiqueta="Oportunidad"
            valor={conteos?.con_oportunidad_abierta ?? "…"}
            detalle={conteos ? `${formatoMonedaEntera.format(Number(conteos.valor_oportunidades_abiertas))} en juego` : undefined}
            tono="ok"
          />
        </div>

        <form
          className="flex flex-wrap items-center gap-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            cambiar(() => setBusqueda(q.trim()));
          }}
        >
          <CajaBusqueda placeholder="Buscar por nombre, giro o ciudad…" valor={q} onCambiar={setQ} />
          <select aria-label="Giro" className={`${inputBaseClass} h-10 w-auto max-w-[200px]`} value={giro} onChange={(e) => cambiar(() => setGiro(e.target.value))}>
            <option value="">Giro: Todos</option>
            {giros.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select aria-label="Región" className={`${inputBaseClass} h-10 w-auto max-w-[200px]`} value={region} onChange={(e) => cambiar(() => setRegion(e.target.value))}>
            <option value="">Región: Todas</option>
            {regiones.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {esAdminOSupervisor && (
            <select aria-label="Responsable" className={`${inputBaseClass} h-10 w-auto max-w-[220px]`} value={responsable} onChange={(e) => cambiar(() => setResponsable(e.target.value))}>
              <option value="">Responsable: Todos</option>
              <option value="sin">Sin responsable</option>
              {(usuarios?.data ?? [])
                .filter((u) => u.rol !== "sistema")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nombre}
                  </option>
                ))}
            </select>
          )}
          <select aria-label="Ordenar" className={`${inputBaseClass} h-10 w-auto md:ml-auto`} value={orden} onChange={(e) => cambiar(() => setOrden(e.target.value as Orden))}>
            <option value="actividad">Ordenar: Última actividad</option>
            <option value="nombre">Ordenar: Nombre (A–Z)</option>
          </select>
          <Segmento
            etiqueta="Vista"
            className="md:!w-auto"
            valor={vista}
            onCambiar={setVista}
            opciones={[
              { id: "lista", texto: "Lista" },
              { id: "tarjetas", texto: "Tarjetas" }
            ]}
          />
        </form>

        {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="text-sm text-danger">No se pudo cargar el listado de empresas.</div>}
        {data && data.data.length === 0 && hayFiltros && <div className="tarjeta-blanca p-5 text-sm text-ink-3">No hay empresas con ese filtro.</div>}
        {data && data.data.length === 0 && !hayFiltros && page === 1 && (
          <EstadoVacio className="tarjeta-blanca p-5" titulo="Todavía no hay empresas." texto="Da de alta la primera con + Nueva empresa, junto con su contacto principal." />
        )}

        {data && data.data.length > 0 && vista === "lista" && (
          <section className="tarjeta-blanca overflow-hidden">
            <ListaEmpresas empresas={data.data} />
            {(page > 1 || data.data.length === LIMIT) && (
              <div className="border-t border-border bg-soft">
                <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />
              </div>
            )}
          </section>
        )}
        {data && data.data.length > 0 && vista === "tarjetas" && (
          <>
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
              {data.data.map((e) => (
                <TarjetaEmpresa key={e.id} empresa={e} />
              ))}
            </div>
            {(page > 1 || data.data.length === LIMIT) && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
          </>
        )}
      </div>

      <PanelLateral
        abierto={creando}
        onCerrar={() => setCreando(false)}
        encabezado={
          <div>
            <h2 className="pt-1 font-heading text-[20px] font-black text-strong">Nueva empresa</h2>
            <p className="mt-1 text-[13px] text-ink-2">Con su contacto principal. Lo demás se completa en la ficha.</p>
          </div>
        }
        cuerpoClassName="!p-0"
      >
        <EmpresaForm enPanel onDone={() => setCreando(false)} />
      </PanelLateral>
    </AppShell>
  );
}

function distintos(valores: (string | null | undefined)[] | undefined) {
  return [...new Set((valores ?? []).filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b, "es"));
}

function ubicacion(e: EmpresaFila) {
  return { arriba: e.ciudad ?? e.estado ?? "—", abajo: e.ciudad ? (e.estado ?? e.region ?? "") : (e.region ?? "") };
}

// Lista: tabla en compu y tarjeta compacta en el celular (como Prospectos).
function ListaEmpresas({ empresas }: { empresas: EmpresaFila[] }) {
  const navigate = useNavigate();
  const abrir = (id: number) => navigate(`/empresas/${id}`);
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {empresas.map((e) => {
          const pros = prospeccionEmpresa(e.prospeccion);
          return (
            <li key={e.id}>
              <Link to={`/empresas/${e.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 active:bg-soft">
                <div className="flex min-w-0 items-center gap-3">
                  <LogoEmpresa id={e.id} nombre={e.nombre_legal} />
                  <div className="min-w-0">
                    <b className="block truncate text-[14px] text-strong">{e.nombre_legal}</b>
                    <small className="block truncate text-[12px] text-ink-3">{[e.giro ?? "sin giro", e.ciudad ?? e.estado].filter(Boolean).join(" · ")}</small>
                  </div>
                </div>
                <UltimaActividad empresa={e} alinear="derecha" />
                <span className="flex min-w-0 items-center gap-2 text-[12px] text-ink-2">
                  <Avatar nombre={e.propietario_nombre} />
                  <span className="truncate">{e.propietario_nombre ?? "Sin responsable"}</span>
                </span>
                <Pastilla tono={pros.tono} punto className="justify-self-end">
                  {pros.texto}
                </Pastilla>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="tabla-scroll hidden md:block">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-soft">
              {["Empresa", "Ubicación", "Responsable", "Contactos", "Prospección", "Última actividad"].map((h) => (
                <th key={h} className="px-4 py-3 text-left font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3 first:pl-[18px]">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empresas.map((e) => {
              const pros = prospeccionEmpresa(e.prospeccion);
              const u = ubicacion(e);
              return (
                <tr key={e.id} tabIndex={0} onClick={() => abrir(e.id)} onKeyDown={(ev) => ev.key === "Enter" && abrir(e.id)} className="cursor-pointer border-t border-border hover:bg-soft">
                  <td className="px-4 py-3 pl-[18px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <LogoEmpresa id={e.id} nombre={e.nombre_legal} />
                      <div className="min-w-0">
                        <Link to={`/empresas/${e.id}`} onClick={(ev) => ev.stopPropagation()} className="block truncate text-[14px] font-bold text-strong hover:underline">
                          {e.nombre_legal}
                        </Link>
                        <small className="block truncate text-[12px] text-ink-3">{[e.giro ?? "— sin giro", e.nombre_comercial].filter(Boolean).join(" · ")}</small>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink">
                    {u.arriba}
                    {u.abajo && <small className="block text-[12px] text-ink-3">{u.abajo}</small>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={clsx("flex items-center gap-2 text-[13px]", e.propietario_nombre ? "text-ink" : "text-ink-3")}>
                      <Avatar nombre={e.propietario_nombre} />
                      <span className="truncate">{e.propietario_nombre ?? "Sin responsable"}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="mono inline-grid h-7 min-w-7 place-items-center rounded-[9px] bg-soft px-2 text-[13px] font-extrabold text-strong">{e.contactos_activos}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Pastilla tono={pros.tono} punto>
                      {pros.texto}
                    </Pastilla>
                  </td>
                  <td className="px-4 py-3">
                    <UltimaActividad empresa={e} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function UltimaActividad({ empresa: e, alinear = "izquierda" }: { empresa: EmpresaFila; alinear?: "izquierda" | "derecha" }) {
  const vieja = actividadVieja(e.ultima_actividad);
  return (
    <div className={clsx("whitespace-nowrap", alinear === "derecha" && "text-right")}>
      <b className={clsx("block text-[13px]", vieja ? "text-ink-3" : "text-strong")}>{e.ultima_actividad ? fechaCorta(e.ultima_actividad) : "—"}</b>
      <small className={clsx("block text-[12px]", vieja && !e.ultima_actividad ? "text-danger" : "text-ink-3")}>{textoUltimaActividad(e.ultima_actividad_detalle)}</small>
    </div>
  );
}

// Vista de tarjetas: la N de marca de agua, contactos, prospección y
// última actividad, y abajo estado y responsable.
function TarjetaEmpresa({ empresa: e }: { empresa: EmpresaFila }) {
  const pros = prospeccionEmpresa(e.prospeccion);
  return (
    <Link to={`/empresas/${e.id}`} className="tarjeta-blanca relative flex flex-col gap-3.5 overflow-hidden p-[18px] hover:border-navy/40">
      <MarcaDeAgua className="-bottom-[38px] -right-[28px] w-[130px]" />
      <div className="relative flex min-w-0 items-center gap-3">
        <LogoEmpresa id={e.id} nombre={e.nombre_legal} />
        <div className="min-w-0">
          <h4 className="truncate font-heading text-[15px] font-extrabold text-strong">{e.nombre_legal}</h4>
          <div className="truncate text-[12px] text-ink-3">{[e.giro ?? "— sin giro", e.ciudad ?? e.estado].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <div className="relative grid grid-cols-3 gap-2 rounded-[12px] bg-soft px-3 py-2.5">
        <Dato valor={String(e.contactos_activos)} etiqueta="Contactos" />
        <Dato valor={e.prospeccion ? `${Math.min(e.prospeccion.envios, 3)}/3` : "—"} etiqueta="Correos" />
        <Dato valor={e.ultima_actividad ? fechaCorta(e.ultima_actividad).replace(/, .*/, "") : "—"} etiqueta="Última" />
      </div>
      <div className="relative flex flex-wrap items-center justify-between gap-2">
        <Pastilla tono={pros.tono} punto>
          {pros.texto}
        </Pastilla>
        <span className={clsx("flex min-w-0 items-center gap-2 text-[12px]", e.propietario_nombre ? "text-ink-2" : "text-ink-3")}>
          <Avatar nombre={e.propietario_nombre} />
          <span className="truncate">{e.propietario_nombre ?? "Sin responsable"}</span>
        </span>
      </div>
    </Link>
  );
}

function Dato({ valor, etiqueta }: { valor: string; etiqueta: string }) {
  return (
    <div className="min-w-0">
      <b className="mono block truncate text-[15px] font-extrabold text-strong">{valor}</b>
      <small className="text-[11px] font-bold text-ink-3">{etiqueta}</small>
    </div>
  );
}
