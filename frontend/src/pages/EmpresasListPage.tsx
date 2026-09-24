import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { api } from "../lib/api";
import type { Empresa, Paginated } from "../types";

const LIMIT = 25;

export function EmpresasListPage() {
  const [page, setPage] = useState(1);

  // GET /api/v1/empresas (src/crm/empresas.controller.ts): un agente ve
  // solo las suyas, el backend decide eso solo -- este componente no
  // filtra por dueño. Hoy solo pagina (page/limit); el listado no acepta
  // todavía filtros de región/giro/tamaño del lado del servidor.
  const { data, isPending, isError } = useQuery({
    queryKey: ["empresas", page],
    queryFn: () => api.get<Paginated<Empresa>>("/api/v1/empresas", { page, limit: LIMIT })
  });

  return (
    <AppShell titulo="Empresas">
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-bold">Empresas</div>
          <span className="text-xs text-ink-3">{data ? `${data.data.length} de esta página` : ""}</span>
        </div>

        {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="p-6 text-sm text-danger">No se pudo cargar el listado de empresas.</div>}

        {data && data.data.length === 0 && <div className="p-6 text-sm text-ink-2">No hay empresas todavía.</div>}

        {data && data.data.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {["Nombre legal", "Giro", "Región / ciudad", "Estado"].map((h) => (
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
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${empresa.activo ? "bg-ok-bg text-ok" : "bg-bg text-ink-3"}`}>
                      {empresa.activo ? "Activa" : "Desactivada"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {data && (
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="rounded-[9px] border border-border bg-white px-3.5 py-2 text-xs font-semibold text-ink-2 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-xs text-ink-3">Página {page}</span>
          <button
            type="button"
            disabled={data.data.length < LIMIT}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-[9px] border border-border bg-white px-3.5 py-2 text-xs font-semibold text-ink-2 disabled:opacity-40"
          >
            Siguiente
          </button>
        </div>
      )}
    </AppShell>
  );
}
