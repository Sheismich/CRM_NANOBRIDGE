import { useQuery } from "@tanstack/react-query";
import { Card } from "../ui/Card";
import { api } from "../../lib/api";
import type { Oportunidad, Paginated } from "../../types";

const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const formatoFecha = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });

// Columna DATE: "2026-10-01" solo, new Date() lo toma como medianoche UTC
// y en México se mostraría como el día anterior.
function fechaLocal(valor: string) {
  return new Date(valor.length === 10 ? `${valor}T00:00:00` : valor);
}

function claseEtapa(o: Oportunidad) {
  if (o.etapa_clave === "ganada") return "bg-ok-bg text-ok";
  if (o.etapa_clave === "perdida") return "bg-danger-bg text-danger";
  return "bg-bg text-navy";
}

export function OportunidadesTab({ empresaId }: { empresaId: number }) {
  // Filtro empresaId en GET /oportunidades agregado para esta pestaña
  // (oportunidad.schema.ts). Para un agente el backend además acota a las
  // suyas -- puede haber otras oportunidades de la empresa que no vea.
  const { data, isPending, isError } = useQuery({
    queryKey: ["oportunidades", { empresaId }],
    queryFn: () => api.get<Paginated<Oportunidad>>("/api/v1/oportunidades", { empresaId, limit: 100 })
  });

  return (
    <Card className="overflow-hidden">
      {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-6 text-sm text-danger">No se pudieron cargar las oportunidades.</div>}
      {data && data.data.length === 0 && <div className="p-6 text-sm text-ink-3">Esta empresa no tiene oportunidades todavía.</div>}

      {data && data.data.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {["Oportunidad", "Etapa", "Probabilidad", "Valor estimado", "Cierre estimado"].map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((o) => (
              <tr key={o.id} className="border-t border-border">
                <td className="px-5 py-3 text-[13px] font-semibold">{o.titulo}</td>
                <td className="px-5 py-3">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${claseEtapa(o)}`}>{o.etapa_nombre}</span>
                </td>
                <td className="px-5 py-3 text-[13px] text-ink-2">{o.probabilidad}%</td>
                <td className="px-5 py-3 text-[13px] text-ink-2">{o.valor_estimado ? formatoMoneda.format(Number(o.valor_estimado)) : "—"}</td>
                <td className="px-5 py-3 text-[13px] text-ink-2">{o.fecha_cierre_estimada ? formatoFecha.format(fechaLocal(o.fecha_cierre_estimada)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
