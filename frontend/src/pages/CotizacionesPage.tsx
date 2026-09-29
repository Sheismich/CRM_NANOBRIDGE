import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";
import { inputBaseClass } from "../components/ui/Field";
import { Paginacion } from "../components/ui/Paginacion";
import { api } from "../lib/api";
import { ETIQUETA_ESTADO_COTIZACION, claseEstadoCotizacion } from "../lib/cotizaciones";
import { fechaLocal, formatoFecha, formatoMoneda } from "../lib/formato";
import type { Cotizacion, EstadoCotizacion, Paginated } from "../types";

// Cotizaciones de todas las empresas (GET /cotizaciones sin empresaId): un
// agente ve las de sus oportunidades. El detalle, las versiones y los
// cambios de estado siguen en la pestaña Cotizaciones de la ficha, a donde
// lleva cada fila. Por defecto, las enviadas: las que esperan respuesta.

type CotizacionFila = Cotizacion & { empresa_nombre: string | null; oportunidad_titulo: string | null };
const LIMIT = 25;
const FILTROS: { valor: string; etiqueta: string }[] = [
  { valor: "enviada", etiqueta: "Enviadas (esperan respuesta)" },
  { valor: "borrador", etiqueta: "Borradores" },
  { valor: "aceptada", etiqueta: "Aceptadas" },
  { valor: "rechazada", etiqueta: "Rechazadas" },
  { valor: "vencida", etiqueta: "Vencidas" },
  { valor: "", etiqueta: "Todas" }
];

export function CotizacionesPage() {
  const navigate = useNavigate();
  const [estado, setEstado] = useState("enviada");
  const [page, setPage] = useState(1);

  const filtros = { estado: estado || undefined, page, limit: LIMIT };
  const { data, isPending, isError } = useQuery({
    queryKey: ["cotizaciones", "general", filtros],
    queryFn: () => api.get<Paginated<CotizacionFila>>("/api/v1/cotizaciones", filtros)
  });
  const total = (data?.data ?? []).reduce((acc, c) => acc + Number(c.total), 0);

  return (
    <AppShell titulo="Cotizaciones">
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <select
            aria-label="Estado"
            className={`${inputBaseClass} w-auto`}
            value={estado}
            onChange={(e) => {
              setPage(1);
              setEstado(e.target.value);
            }}
          >
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
          {data && data.data.length > 0 && (
            <div className="text-[13px] text-ink-2">
              {data.data.length} en esta página · <b className="text-ink">{formatoMoneda.format(total)}</b>
            </div>
          )}
        </div>

        {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las cotizaciones.</div>}
        {data && data.data.length === 0 && (
          <div className="p-5 text-sm text-ink-3">No hay cotizaciones{estado ? ` en estado "${ETIQUETA_ESTADO_COTIZACION[estado as EstadoCotizacion].toLowerCase()}"` : ""}.</div>
        )}
        {data && data.data.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {["Empresa", "Oportunidad", "Versión", "Total", "Estado", "Emitida", "Enviada", "Cierre esperado"].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr
                  key={c.id}
                  className="cursor-pointer border-t border-border hover:bg-bg"
                  onClick={() => navigate(`/empresas/${c.empresa_id}?tab=cotizaciones`)}
                  title="Abrir en la ficha de la empresa"
                >
                  <td className="px-4 py-3 text-[13px] font-semibold">{c.empresa_nombre ?? `Empresa ${c.empresa_id}`}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{c.oportunidad_titulo ?? "—"}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">v{c.version}</td>
                  <td className="px-4 py-3 text-[13px] font-semibold tabular-nums">{formatoMoneda.format(Number(c.total))}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${claseEstadoCotizacion(c.estado)}`}>{ETIQUETA_ESTADO_COTIZACION[c.estado]}</span>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{formatoFecha.format(fechaLocal(c.fecha_emision))}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{c.fecha_envio ? formatoFecha.format(fechaLocal(c.fecha_envio)) : "—"}</td>
                  <td className="px-4 py-3 text-[13px] text-ink-2">{c.fecha_esperada_cierre ? formatoFecha.format(fechaLocal(c.fecha_esperada_cierre)) : "—"}</td>
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
