import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { PanelDocumento } from "../components/documentos/PanelDocumento";
import { SubirDocumentoPanel } from "../components/documentos/SubirDocumentoPanel";
import { Button } from "../components/ui/Button";
import { Contador, FilaContadores } from "../components/ui/Contador";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { Icono } from "../components/ui/Icono";
import { Paginacion } from "../components/ui/Paginacion";
import { Pastilla } from "../components/ui/Pastilla";
import { inputBaseClass } from "../components/ui/Field";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { ETIQUETA_REVISION, TONO_REVISION, claseExtension, colorEmpresa, cuando, extension, inicialesEmpresa, useCatalogosDocumentos, useConteosDocumentos } from "../lib/documentos";
import { formatoTamano } from "../lib/formato";
import type { Documento, DocumentoBandeja, Empresa, Paginated } from "../types";

// Documentos del rediseño (docs/diseno/documentos.html, ajustes del
// 11-oct): Descargar lote y Subir documento arriba, contadores (que también
// filtran), búsqueda y filtros, y la bandeja. Al dar clic en un documento
// se abre su panel con la vista previa, Aprobar / Rechazar y el resumen del
// expediente. Por omisión, lo que falta por revisar.
const LIMIT = 25;
type Revision = Documento["revision"] | "";

export function DocumentosPage() {
  const { user } = useAuth();
  const puedeRevisar = user?.rol === "administrador" || user?.rol === "supervisor";
  const ahora = new Date();
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  const [revision, setRevision] = useState<Revision>("por_revisar");
  const [tipo, setTipo] = useState("");
  const [empresaId, setEmpresaId] = useState("");
  const [page, setPage] = useState(1);
  const [abierto, setAbierto] = useState<DocumentoBandeja | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [errorLote, setErrorLote] = useState<string | null>(null);
  const [bajandoLote, setBajandoLote] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(texto.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [texto]);

  const filtrosBase = { revision: revision || undefined, tipoDocumentoId: tipo || undefined, empresaId: empresaId || undefined, q: q || undefined };
  const filtros = { ...filtrosBase, estado: "vigente" as const, page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["documentos", "bandeja", filtros],
    queryFn: () => api.get<Paginated<DocumentoBandeja>>("/api/v1/documentos", filtros)
  });
  const conteos = useConteosDocumentos();
  const { data: catalogos } = useCatalogosDocumentos();
  const { data: empresas } = useQuery({
    queryKey: ["empresas", "selector"],
    queryFn: () => api.get<Paginated<Empresa>>("/api/v1/empresas", { limit: 100 }),
    staleTime: 5 * 60_000
  });

  function filtrar<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }
  const porRevision = filtrar(setRevision);

  async function descargarLote() {
    setErrorLote(null);
    setBajandoLote(true);
    try {
      const params = new URLSearchParams(Object.entries(filtrosBase).filter((e): e is [string, string] => Boolean(e[1])));
      const qs = params.toString();
      await api.descargar(`/api/v1/documentos/lote${qs ? `?${qs}` : ""}`);
    } catch (err) {
      setErrorLote(err instanceof ApiError ? err.message : "No se pudo descargar el lote");
    } finally {
      setBajandoLote(false);
    }
  }

  const c = conteos.data;
  const hayFiltro = Boolean(q || tipo || empresaId);

  return (
    <AppShell
      titulo="Documentos"
      encabezado={
        <EncabezadoPagina
          titulo="Documentos"
          subtitulo="Actas, contratos e identificaciones de cada cliente, revisados y al día."
          acciones={
            <>
              {puedeRevisar && (
                <Button variant="outline" disabled={bajandoLote} onClick={() => void descargarLote()} title="Un .zip con los documentos que se ven con los filtros de abajo">
                  <Icono nombre="descargar" size={17} /> {bajandoLote ? "Preparando…" : "Descargar lote"}
                </Button>
              )}
              <Button onClick={() => setSubiendo(true)}>
                <Icono nombre="subir" size={17} /> Subir documento
              </Button>
            </>
          }
        />
      }
    >
      {errorLote && <p className="mb-3 rounded-[12px] bg-danger-bg px-4 py-2.5 text-[13px] text-danger">{errorLote}</p>}

      <FilaContadores>
        <Contador etiqueta="Por revisar" valor={c?.por_revisar ?? "…"} detalle="subidos sin revisar" tono="warn" seleccionado={revision === "por_revisar"} onClick={() => porRevision(revision === "por_revisar" ? "" : "por_revisar")} />
        <Contador etiqueta="Aprobados" valor={c?.aprobados ?? "…"} detalle="vigentes" tono="ok" seleccionado={revision === "aprobado"} onClick={() => porRevision(revision === "aprobado" ? "" : "aprobado")} />
        <Contador etiqueta="Expedientes incompletos" valor={c?.expedientes_incompletos ?? "…"} detalle="ventas ganadas con faltantes" tono="warn" />
        <Contador etiqueta="Rechazados" valor={c?.rechazados ?? "…"} detalle="por corregir" tono="danger" seleccionado={revision === "rechazado"} onClick={() => porRevision(revision === "rechazado" ? "" : "rechazado")} />
      </FilaContadores>

      <div className="my-4 flex flex-wrap items-center gap-2">
        <label className="flex h-10 min-w-[220px] flex-[1_1_260px] items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-ink-3 md:max-w-[420px]">
          <Icono nombre="buscar" size={16} />
          <input aria-label="Buscar documentos" placeholder="Buscar por nombre de archivo o empresa…" className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </label>
        <select aria-label="Tipo" className={`${inputBaseClass} h-10 w-auto`} value={tipo} onChange={(e) => filtrar(setTipo)(e.target.value)}>
          <option value="">Tipo: todos</option>
          {(catalogos?.tipos_documento ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <select aria-label="Empresa" className={`${inputBaseClass} h-10 w-auto max-w-[220px]`} value={empresaId} onChange={(e) => filtrar(setEmpresaId)(e.target.value)}>
          <option value="">Empresa: todas</option>
          {(empresas?.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nombre_comercial ?? e.nombre_legal}
            </option>
          ))}
        </select>
        <select aria-label="Revisión" className={`${inputBaseClass} h-10 w-auto`} value={revision} onChange={(e) => porRevision(e.target.value as Revision)}>
          <option value="">Revisión: todas</option>
          {Object.entries(ETIQUETA_REVISION).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>

      <div className="tarjeta-blanca overflow-hidden !rounded-[18px]">
        {isPending && <p className="p-5 text-[13px] text-ink-3">Cargando…</p>}
        {isError && <p className="p-5 text-[13px] text-danger">No se pudieron cargar los documentos.</p>}
        {data && data.data.length === 0 && (
          <p className="p-5 text-[13px] text-ink-2">
            {hayFiltro ? "No hay documentos con esos filtros." : revision === "por_revisar" ? "No hay nada por revisar. Todo al día." : "No hay documentos aquí todavía."}
          </p>
        )}
        <ul>
          {data?.data.map((d) => (
            <FilaDocumento key={d.id} d={d} ahora={ahora} onAbrir={() => setAbierto(d)} />
          ))}
        </ul>
        {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
      </div>

      <PanelDocumento fila={abierto} onCerrar={() => setAbierto(null)} puedeRevisar={puedeRevisar} />
      <SubirDocumentoPanel abierto={subiendo} onCerrar={() => setSubiendo(false)} />
    </AppShell>
  );
}

function FilaDocumento({ d, ahora, onAbrir }: { d: DocumentoBandeja; ahora: Date; onAbrir: () => void }) {
  const ext = extension(d);
  const [bajando, setBajando] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 first:border-t-0 hover:bg-soft md:flex-nowrap md:px-5">
      <button type="button" onClick={onAbrir} className="flex min-w-0 flex-[1_1_100%] items-center gap-3 text-left md:flex-[1_1_40%]">
        <span className={clsx("grid h-11 w-10 shrink-0 place-items-center rounded-[8px] text-[10px] font-extrabold", claseExtension(ext))}>{ext}</span>
        <span className="min-w-0">
          <b className="block truncate text-[14px] font-bold text-strong">{d.nombre_original}</b>
          {d.revision === "rechazado" && d.motivo_rechazo_detalle ? (
            <small className="block truncate text-[12px] text-danger">Motivo: {d.motivo_rechazo_detalle}</small>
          ) : (
            <small className="block truncate text-[12px] text-ink-3">{[d.tipo_nombre ?? "Sin tipo", formatoTamano(d.tamano_bytes)].join(" · ")}</small>
          )}
        </span>
      </button>
      <Link to={`/empresas/${d.empresa_id}?tab=documentos`} className="flex min-w-0 items-center gap-2 text-[13px] text-ink hover:text-navy md:flex-[0_1_22%]">
        <span className={clsx("grid h-6 w-7 shrink-0 place-items-center rounded-[7px] text-[9.5px] font-extrabold text-white", colorEmpresa(d.empresa_id))}>{inicialesEmpresa(d.empresa_nombre)}</span>
        <span className="truncate">{d.empresa_nombre}</span>
      </Link>
      <span className="w-[86px] shrink-0 text-[12.5px] font-bold text-strong">
        {cuando(d.creado_en, ahora)}
        <small className="block text-[11px] font-normal text-ink-3">subido</small>
      </span>
      <span className="shrink-0 md:w-[110px]">
        <Pastilla tono={TONO_REVISION[d.revision]} punto>
          {ETIQUETA_REVISION[d.revision]}
        </Pastilla>
      </span>
      <span className="ml-auto flex shrink-0 items-center justify-end gap-2 lg:w-[150px]">
        {d.revisado_por_nombre && d.revisado_en && <small className="hidden text-[11.5px] text-ink-3 lg:inline">{`${d.revisado_por_nombre.split(" ")[0]}, ${cuando(d.revisado_en, ahora).replace(/^Hoy, /, "hoy ")}`}</small>}
        <button
          type="button"
          aria-label={`Descargar ${d.nombre_original}`}
          title="Descargar"
          disabled={bajando}
          onClick={() => {
            setBajando(true);
            void api.descargar(`/api/v1/documentos/${d.id}/descarga`).finally(() => setBajando(false));
          }}
          className="grid h-8 w-8 place-items-center rounded-[9px] border border-border bg-card text-navy hover:border-navy/40 disabled:opacity-50"
        >
          <Icono nombre="descargar" size={15} />
        </button>
      </span>
    </li>
  );
}
