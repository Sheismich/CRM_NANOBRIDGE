import { Fragment, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { OportunidadDetallePanel } from "../components/ficha/OportunidadDetallePanel";
import { Card } from "../components/ui/Card";
import { inputBaseClass } from "../components/ui/Field";
import { Paginacion } from "../components/ui/Paginacion";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { fechaLocal, formatoFecha, formatoMonedaEntera, plural } from "../lib/formato";
import type { CatalogosOportunidad, Oportunidad, Paginated, Usuario } from "../types";

// Oportunidades (PLAN_FRONTEND.md §5 punto #3; CRM_09 "Pipeline de
// oportunidades: tablero por etapa, filtros por agente"). Un agente solo ve
// las suyas (lo filtra el backend). El cambio de etapa, la pérdida con
// motivo y la reapertura se hacen en el mismo panel de detalle que la ficha
// de cliente. Las oportunidades nuevas se crean desde la ficha, porque
// cuelgan de una empresa y de sus contactos.

type OportunidadFila = Oportunidad & { empresa_nombre?: string | null };

// El backend permite hasta 100 por página: una consulta por columna.
const LIMITE_COLUMNA = 100;
const LIMITE_CERRADAS = 25;

export function OportunidadesPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  const [vista, setVista] = useState<"abiertas" | "cerradas">("abiertas");
  const [responsableId, setResponsableId] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [abiertaId, setAbiertaId] = useState<number | null>(null);

  const { data: catalogos } = useQuery({
    queryKey: ["oportunidades-catalogos"],
    queryFn: () => api.get<CatalogosOportunidad>("/api/v1/oportunidades/catalogos"),
    staleTime: Infinity
  });
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor,
    staleTime: 5 * 60_000
  });
  const personas = usuarios?.data.filter((u) => u.rol !== "sistema");
  const nombreDe = (id: number | null) => (id == null ? "Sin asignar" : (personas?.find((u) => u.id === id)?.nombre ?? `Usuario ${id}`));

  // Búsqueda local sobre lo ya cargado (el backend no filtra por texto).
  const coincide = (o: OportunidadFila) => {
    const q = busqueda.trim().toLowerCase();
    return !q || o.titulo.toLowerCase().includes(q) || (o.empresa_nombre ?? "").toLowerCase().includes(q);
  };

  return (
    <AppShell titulo="Oportunidades">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 overflow-x-auto border-b border-border">
          {(["abiertas", "cerradas"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setVista(v);
                setAbiertaId(null);
              }}
              className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold ${vista === v ? "border-b-2 border-navy text-navy" : "text-ink-3"}`}
            >
              {v === "abiertas" ? "Embudo" : "Ganadas y perdidas"}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <input aria-label="Buscar" placeholder="Buscar por oportunidad o empresa…" className={`${inputBaseClass} w-64`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
          {esAdminOSupervisor && (
            <select aria-label="Responsable" className={`${inputBaseClass} w-auto`} value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
              <option value="">Responsable: Todos</option>
              {personas?.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {vista === "abiertas" ? (
        catalogos ? (
          <Tablero
            etapas={catalogos.etapas.filter((e) => !e.es_cierre).sort((a, b) => a.orden - b.orden)}
            responsableId={responsableId}
            coincide={coincide}
            abiertaId={abiertaId}
            onAbrir={setAbiertaId}
            nombreDe={esAdminOSupervisor ? nombreDe : undefined}
          />
        ) : (
          <div className="text-sm text-ink-2">Cargando…</div>
        )
      ) : (
        <Cerradas responsableId={responsableId} coincide={coincide} abiertaId={abiertaId} onAbrir={setAbiertaId} nombreDe={esAdminOSupervisor ? nombreDe : undefined} />
      )}
    </AppShell>
  );
}

type PropsVista = {
  responsableId: string;
  coincide: (o: OportunidadFila) => boolean;
  abiertaId: number | null;
  onAbrir: (id: number | null) => void;
  nombreDe?: (id: number | null) => string;
};

function Tablero({ etapas, responsableId, coincide, abiertaId, onAbrir, nombreDe }: PropsVista & { etapas: CatalogosOportunidad["etapas"] }) {
  const columnas = useQueries({
    queries: etapas.map((e) => ({
      queryKey: ["oportunidades", "tablero", e.clave, responsableId],
      queryFn: () => api.get<Paginated<OportunidadFila>>("/api/v1/oportunidades", { cerrada: "false", etapaClave: e.clave, responsableId: responsableId || undefined, limit: LIMITE_COLUMNA })
    }))
  });
  const todas = columnas.flatMap((c) => c.data?.data ?? []).filter(coincide);
  const valor = todas.reduce((acc, o) => acc + Number(o.valor_estimado ?? 0), 0);
  const ponderado = todas.reduce((acc, o) => acc + (Number(o.valor_estimado ?? 0) * o.probabilidad) / 100, 0);
  const abierta = todas.find((o) => o.id === abiertaId);
  // El detalle va debajo del tablero: sin esto, al abrir una tarjeta de
  // una columna larga parecía que no pasaba nada.
  const detalleRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (abiertaId) detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [abiertaId]);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="text-[13px] text-ink-2">
        {plural(todas.length, "oportunidad abierta", "oportunidades abiertas")} · pipeline <b className="text-ink">{formatoMonedaEntera.format(valor)}</b> · ponderado por probabilidad{" "}
        <b className="text-ink">{formatoMonedaEntera.format(ponderado)}</b>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1100px] gap-3" style={{ gridTemplateColumns: `repeat(${etapas.length}, minmax(0, 1fr))` }}>
          {etapas.map((etapa, i) => {
            const consulta = columnas[i]!;
            const items = (consulta.data?.data ?? []).filter(coincide);
            const total = items.reduce((acc, o) => acc + Number(o.valor_estimado ?? 0), 0);
            return (
              <div key={etapa.clave} className="flex min-h-40 flex-col gap-2 rounded-[14px] border border-border bg-card/60 p-2.5">
                <div className="px-1.5 pb-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-bold">{etapa.nombre}</span>
                    <span className="rounded-full bg-bg px-2 py-0.5 text-[11px] font-bold text-ink-2">{items.length}</span>
                  </div>
                  <div className="text-[11px] text-ink-3">
                    {formatoMonedaEntera.format(total)} · {etapa.probabilidad}%
                  </div>
                </div>
                {consulta.isPending && <div className="px-1.5 text-xs text-ink-3">Cargando…</div>}
                {consulta.isError && <div className="px-1.5 text-xs text-danger">No se pudo cargar.</div>}
                {items.map((o) => {
                  const atrasada = o.fecha_cierre_estimada ? fechaLocal(o.fecha_cierre_estimada) < hoy : false;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => onAbrir(abiertaId === o.id ? null : o.id)}
                      className={`flex flex-col gap-1 rounded-[10px] border bg-card p-3 text-left shadow-[0_1px_2px_rgba(21,28,54,0.04)] hover:border-navy ${abiertaId === o.id ? "border-navy ring-1 ring-navy" : "border-border"}`}
                    >
                      <span className="text-[13px] font-semibold leading-snug">{o.titulo}</span>
                      <span className="truncate text-xs text-ink-2">{o.empresa_nombre ?? `Empresa ${o.empresa_id}`}</span>
                      <span className="mt-1 flex items-center justify-between gap-2 text-xs">
                        <b>{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</b>
                        {o.fecha_cierre_estimada && <span className={atrasada ? "font-semibold text-danger" : "text-ink-3"}>{formatoFecha.format(fechaLocal(o.fecha_cierre_estimada))}</span>}
                      </span>
                      {nombreDe && <span className="text-[11px] text-ink-3">{nombreDe(o.responsable_id)}</span>}
                    </button>
                  );
                })}
                {consulta.data && consulta.data.data.length === LIMITE_COLUMNA && <div className="px-1.5 text-[11px] text-ink-3">Mostrando las {LIMITE_COLUMNA} más recientes.</div>}
              </div>
            );
          })}
        </div>
      </div>

      {abierta && (
        <div ref={detalleRef} className="scroll-mt-4">
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 pt-4 text-xs text-ink-3">
              <Link to={`/empresas/${abierta.empresa_id}`} className="font-semibold text-navy hover:underline">
                Ver ficha de {abierta.empresa_nombre ?? "la empresa"}
              </Link>
            </div>
            <OportunidadDetallePanel id={abierta.id} onClose={() => onAbrir(null)} />
          </Card>
        </div>
      )}
    </div>
  );
}

function Cerradas({ responsableId, coincide, abiertaId, onAbrir, nombreDe }: PropsVista) {
  const [page, setPage] = useState(1);
  const filtros = { cerrada: "true", responsableId: responsableId || undefined, page, limit: LIMITE_CERRADAS };
  const { data, isPending, isError } = useQuery({
    queryKey: ["oportunidades", "cerradas", filtros],
    queryFn: () => api.get<Paginated<OportunidadFila>>("/api/v1/oportunidades", filtros)
  });
  const filas = (data?.data ?? []).filter(coincide);
  const columnas = ["Oportunidad", "Empresa", "Resultado", "Valor", "Cerrada", ...(nombreDe ? ["Responsable"] : [])];

  return (
    <Card className="overflow-hidden">
      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las oportunidades.</div>}
      {data && filas.length === 0 && <div className="p-5 text-sm text-ink-3">No hay oportunidades cerradas{responsableId ? " con ese filtro" : ""}.</div>}
      {filas.length > 0 && (
        <div className="tabla-scroll"><table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {columnas.map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filas.map((o) => (
              <Fragment key={o.id}>
                <tr className={`cursor-pointer border-t border-border hover:bg-bg ${abiertaId === o.id ? "bg-bg" : ""}`} onClick={() => onAbrir(abiertaId === o.id ? null : o.id)}>
                  <td className="px-5 py-3 text-[13px] font-semibold">{o.titulo}</td>
                  <td className="px-5 py-3 text-[13px]">
                    <Link to={`/empresas/${o.empresa_id}`} className="hover:text-navy hover:underline" onClick={(e) => e.stopPropagation()}>
                      {o.empresa_nombre ?? `Empresa ${o.empresa_id}`}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${o.etapa_clave === "ganada" ? "bg-ok-bg text-ok" : "bg-danger-bg text-danger"}`}>{o.etapa_nombre}</span>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{formatoFecha.format(new Date(o.actualizado_en))}</td>
                  {nombreDe && <td className="px-5 py-3 text-[13px] text-ink-2">{nombreDe(o.responsable_id)}</td>}
                </tr>
                {abiertaId === o.id && (
                  <tr>
                    <td colSpan={columnas.length} className="p-0">
                      <OportunidadDetallePanel id={o.id} onClose={() => onAbrir(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      {data && <Paginacion page={page} limit={LIMITE_CERRADAS} cantidad={data.data.length} onPage={setPage} />}
    </Card>
  );
}
