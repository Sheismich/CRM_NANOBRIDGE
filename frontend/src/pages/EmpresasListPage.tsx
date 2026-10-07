import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { EmpresaForm } from "../components/empresas/EmpresaForm";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { api } from "../lib/api";
import { formatoFecha } from "../lib/formato";
import type { EmpresaListado, Paginated } from "../types";

const LIMIT = 25;

export function EmpresasListPage() {
  const [page, setPage] = useState(1);
  const [creando, setCreando] = useState(false);

  // GET /api/v1/empresas (src/crm/empresas.controller.ts): un agente ve
  // solo las suyas, el backend decide eso solo -- este componente no
  // filtra por dueño. Hoy solo pagina (page/limit); el listado no acepta
  // todavía filtros de región/giro/tamaño del lado del servidor.
  const { data, isPending, isError } = useQuery({
    queryKey: ["empresas", page],
    queryFn: () => api.get<Paginated<EmpresaListado>>("/api/v1/empresas", { page, limit: LIMIT })
  });

  return (
    <AppShell titulo="Empresas">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-bold">Empresas</div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-3">{data ? `${data.data.length} de esta página` : ""}</span>
            {!creando && <Button onClick={() => setCreando(true)}>+ Nueva empresa</Button>}
          </div>
        </div>

        {creando && <EmpresaForm onDone={() => setCreando(false)} />}

        {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="p-6 text-sm text-danger">No se pudo cargar el listado de empresas.</div>}

        {data && data.data.length === 0 && page === 1 && !creando && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-6">
            <div>
              <div className="text-sm font-semibold">Todavía no hay empresas.</div>
              <div className="text-xs text-ink-3">Da de alta la primera con sus contactos para empezar a registrar actividades y oportunidades.</div>
            </div>
            <Button onClick={() => setCreando(true)}>+ Nueva empresa</Button>
          </div>
        )}
        {data && data.data.length === 0 && page > 1 && <div className="p-6 text-sm text-ink-2">No hay más empresas.</div>}

        {data && data.data.length > 0 && (
          <div className="tabla-scroll"><table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {["Nombre legal", "Giro", "Región / ciudad", "Responsable", "Contactos", "Última actividad"].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((empresa) => (
                <tr key={empresa.id} className="border-t border-border">
                  <td className="px-5 py-3 text-[13px] font-semibold">
                    <Link to={`/empresas/${empresa.id}`} className="hover:text-navy hover:underline">
                      {empresa.nombre_legal}
                    </Link>
                    {empresa.nombre_comercial && <div className="text-xs font-normal text-ink-3">{empresa.nombre_comercial}</div>}
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{empresa.giro ?? "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{[empresa.ciudad, empresa.region].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{empresa.propietario_nombre ?? <span className="text-ink-3">Sin responsable</span>}</td>
                  <td className="px-5 py-3 text-[13px] tabular-nums text-ink-2">{empresa.contactos_activos}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{empresa.ultima_actividad ? formatoFecha.format(new Date(empresa.ultima_actividad)) : <span className="text-ink-3">Ninguna</span>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>

      {data && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-[9px] border border-border bg-card px-3.5 py-2 text-xs font-semibold text-ink-2 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-xs text-ink-3">Página {page}</span>
          <button
            type="button"
            disabled={data.data.length < LIMIT}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-[9px] border border-border bg-card px-3.5 py-2 text-xs font-semibold text-ink-2 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </AppShell>
  );
}
