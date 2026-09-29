import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ServerError, inputBaseClass } from "../components/ui/Field";
import { Paginacion } from "../components/ui/Paginacion";
import { ApiError, api, resolverUrlApi } from "../lib/api";
import { formatoFecha, formatoTamano } from "../lib/formato";
import type { Documento, Paginated } from "../types";

// Documentos de todas las empresas (GET /documentos sin empresaId): un
// agente ve los de sus empresas. Por defecto, los que faltan por revisar
// (PLAN_CRM #8: confirmación de revisión), que se pueden descargar y marcar
// revisados aquí mismo. Subir, versionar y archivar siguen en la ficha.

type DocumentoFila = Documento & { empresa_nombre: string | null };
const LIMIT = 25;

export function DocumentosPage() {
  const queryClient = useQueryClient();
  const [revisado, setRevisado] = useState("false");
  const [estado, setEstado] = useState("vigente");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);

  const filtros = { revisado: revisado || undefined, estado: estado || undefined, page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["documentos", "general", filtros],
    queryFn: () => api.get<Paginated<DocumentoFila>>("/api/v1/documentos", filtros)
  });
  const { data: catalogos } = useQuery({
    queryKey: ["documentos-catalogos"],
    queryFn: () => api.get<{ tipos_documento: { id: number; nombre: string }[] }>("/api/v1/documentos/catalogos"),
    staleTime: Infinity
  });
  const nombreTipo = (id: number | null) => (id == null ? "—" : (catalogos?.tipos_documento.find((t) => t.id === id)?.nombre ?? "—"));

  async function accion(id: number, hacer: () => Promise<void>) {
    setError(null);
    setOcupadoId(id);
    try {
      await hacer();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupadoId(null);
    }
  }

  return (
    <AppShell titulo="Documentos">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap gap-3 px-5 py-3.5">
          <select
            aria-label="Revisión"
            className={`${inputBaseClass} w-auto`}
            value={revisado}
            onChange={(e) => {
              setPage(1);
              setRevisado(e.target.value);
            }}
          >
            <option value="false">Por revisar</option>
            <option value="true">Revisados</option>
            <option value="">Todos</option>
          </select>
          <select
            aria-label="Estado"
            className={`${inputBaseClass} w-auto`}
            value={estado}
            onChange={(e) => {
              setPage(1);
              setEstado(e.target.value);
            }}
          >
            <option value="vigente">Vigentes</option>
            <option value="archivado">Archivados</option>
            <option value="">Vigentes y archivados</option>
          </select>
        </div>
        <div className="px-5">
          <ServerError message={error} />
        </div>

        {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar los documentos.</div>}
        {data && data.data.length === 0 && (
          <div className="p-5 text-sm text-ink-3">{revisado === "false" ? "No hay documentos pendientes de revisión." : "No hay documentos con ese filtro."}</div>
        )}
        {data && data.data.length > 0 && (
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {["Documento", "Empresa", "Tipo", "Tamaño", "Subido", "Revisión", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((d) => (
                <tr key={d.id} className="border-t border-border">
                  <td className="px-4 py-3 text-[13px] font-semibold">
                    {d.nombre_original}
                    {d.version > 1 && <span className="ml-1.5 text-xs font-normal text-ink-3">v{d.version}</span>}
                    {d.estado === "archivado" && <span className="ml-1.5 rounded-full bg-bg px-2 py-0.5 text-[10px] font-bold text-ink-3">Archivado</span>}
                  </td>
                  <td className="px-4 py-3 text-[13px]">
                    <Link to={`/empresas/${d.empresa_id}?tab=documentos`} className="hover:text-navy hover:underline">
                      {d.empresa_nombre ?? `Empresa ${d.empresa_id}`}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{nombreTipo(d.tipo_documento_id)}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{formatoTamano(d.tamano_bytes)}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{formatoFecha.format(new Date(d.creado_en))}</td>
                  <td className="px-4 py-3">
                    {d.revisado_en ? (
                      <span className="rounded-full bg-ok-bg px-2.5 py-1 text-[11px] font-bold text-ok">Revisado {formatoFecha.format(new Date(d.revisado_en))}</span>
                    ) : (
                      <span className="rounded-full bg-warn-bg px-2.5 py-1 text-[11px] font-bold text-warn">Pendiente</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5"
                      disabled={ocupadoId === d.id}
                      onClick={() =>
                        void accion(d.id, async () => {
                          // La URL firmada dura poco: se pide al momento, igual que en la ficha.
                          const { url } = await api.get<{ url: string }>(`/api/v1/documentos/${d.id}/descarga`);
                          window.location.assign(resolverUrlApi(url));
                        })
                      }
                    >
                      Descargar
                    </Button>
                    {!d.revisado_en && (
                      <Button
                        variant="outline"
                        className="ml-1.5 px-3 py-1.5"
                        disabled={ocupadoId === d.id}
                        onClick={() =>
                          void accion(d.id, async () => {
                            await api.patch(`/api/v1/documentos/${d.id}/revisar`, {});
                            await queryClient.invalidateQueries({ queryKey: ["documentos"] });
                          })
                        }
                      >
                        Marcar revisado
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
      </Card>
    </AppShell>
  );
}
