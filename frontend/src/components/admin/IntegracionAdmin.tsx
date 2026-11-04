import { Fragment, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, SectionTitle } from "../ui/Card";
import { ServerError, inputBaseClass } from "../ui/Field";
import { Paginacion } from "../ui/Paginacion";
import { ApiError, api } from "../../lib/api";
import { formatoFechaHora } from "../../lib/formato";
import type { Paginated, ProcesoFallido } from "../../types";

// Procesos fallidos (solo administrador): errores que reportó n8n, con su
// triage abierto → en revisión → resuelto. Cambiar el estado NO reintenta nada.

const LIMIT = 25;

export function IntegracionAdmin() {
  return <ProcesosFallidos />;
}

const ETIQUETA_TRIAGE: Record<ProcesoFallido["estado"], string> = { abierto: "Abierto", en_revision: "En revisión", resuelto: "Resuelto" };
const CLASE_TRIAGE: Record<ProcesoFallido["estado"], string> = {
  abierto: "bg-danger-bg text-danger",
  en_revision: "bg-warn-bg text-warn",
  resuelto: "bg-ok-bg text-ok"
};

function ProcesosFallidos() {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<ProcesoFallido["estado"] | "">("abierto");
  const [page, setPage] = useState(1);
  const [abiertoId, setAbiertoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);

  const filtros = { estado: estado || undefined, page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["procesos-fallidos", filtros],
    queryFn: () => api.get<Paginated<ProcesoFallido>>("/api/v1/procesos-fallidos", filtros)
  });

  async function cambiarEstado(p: ProcesoFallido, nuevo: ProcesoFallido["estado"]) {
    setError(null);
    setOcupadoId(p.id);
    try {
      await api.patch(`/api/v1/procesos-fallidos/${p.id}/estado`, { estado: nuevo });
      await queryClient.invalidateQueries({ queryKey: ["procesos-fallidos"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupadoId(null);
    }
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5">
        <div>
          <SectionTitle>Procesos fallidos</SectionTitle>
          <div className="-mt-2.5 text-xs text-ink-3">Errores reportados por n8n. Cambiar el estado solo lleva el seguimiento; no reintenta nada.</div>
        </div>
        <select aria-label="Estado del proceso" className={`${inputBaseClass} w-auto`} value={estado} onChange={(e) => {
              setPage(1);
              setEstado(e.target.value as ProcesoFallido["estado"] | "");
            }}>
          <option value="abierto">Abiertos</option>
          <option value="en_revision">En revisión</option>
          <option value="resuelto">Resueltos</option>
          <option value="">Todos</option>
        </select>
      </div>
      <div className="px-5 pt-3">
        <ServerError message={error} />
      </div>

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar los procesos fallidos.</div>}
      {data && data.data.length === 0 && <div className="p-5 text-sm text-ink-3">{estado === "abierto" ? "No hay procesos fallidos abiertos." : "No hay procesos con ese estado."}</div>}
      {data && data.data.length > 0 && (
        <div className="tabla-scroll"><table className="mt-3 w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {["Fecha", "Workflow / nodo", "Tipo", "HTTP", "Mensaje", "Estado"].map((h) => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((p) => (
              <Fragment key={p.id}>
                <tr className={`cursor-pointer border-t border-border hover:bg-bg ${abiertoId === p.id ? "bg-bg" : ""}`} onClick={() => setAbiertoId(abiertoId === p.id ? null : p.id)}>
                  <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink-2">{formatoFechaHora.format(new Date(p.creado_en))}</td>
                  <td className="px-4 py-3 text-[13px]">
                    {p.workflow ?? "—"}
                    {p.nodo && <div className="text-xs text-ink-3">{p.nodo}</div>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{p.tipo}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{p.codigo_http ?? "—"}</td>
                  <td className="max-w-xs truncate px-4 py-3 text-xs text-ink-2" title={p.mensaje ?? undefined}>
                    {p.mensaje ?? "—"}
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <select
                      aria-label={`Estado del proceso ${p.id}`}
                      className={`rounded-full border-0 px-2.5 py-1 text-[11px] font-bold ${CLASE_TRIAGE[p.estado]}`}
                      value={p.estado}
                      disabled={ocupadoId === p.id}
                      onChange={(e) => void cambiarEstado(p, e.target.value as ProcesoFallido["estado"])}
                    >
                      {Object.entries(ETIQUETA_TRIAGE).map(([clave, etiqueta]) => (
                        <option key={clave} value={clave}>
                          {etiqueta}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
                {abiertoId === p.id && (
                  <FilaDetalle columnas={6}>
                    {p.mensaje && <Dato etiqueta="Mensaje">{p.mensaje}</Dato>}
                    {p.endpoint && <Dato etiqueta="Endpoint">{p.endpoint}</Dato>}
                    {p.execution_id && <Dato etiqueta="Ejecución de n8n">{p.execution_id}</Dato>}
                    {p.evento_id && <Dato etiqueta="Evento">#{p.evento_id} (se reintenta desde "Eventos hacia n8n")</Dato>}
                    <Json valor={p.payload} />
                  </FilaDetalle>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
    </Card>
  );
}

function FilaDetalle({ columnas, children }: { columnas: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={columnas} className="bg-bg p-0">
        <div className="flex flex-col gap-2 border-t border-border p-5 text-[13px]">{children}</div>
      </td>
    </tr>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <span className="text-ink-3">{etiqueta}: </span>
      <span className="break-all">{children}</span>
    </div>
  );
}

function Json({ valor }: { valor: unknown }) {
  if (valor == null) return null;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[9px] border border-border bg-card p-3 font-mono text-xs text-ink">{JSON.stringify(valor, null, 2)}</pre>;
}
