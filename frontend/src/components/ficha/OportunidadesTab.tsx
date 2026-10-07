import { Fragment, useState } from "react";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { fechaLocal, formatoFecha, formatoMonedaEntera } from "../../lib/formato";
import type { Oportunidad } from "../../types";
import { NuevaOportunidadForm } from "./NuevaOportunidadForm";
import { OportunidadDetallePanel } from "./OportunidadDetallePanel";
import { useOportunidadesEmpresa } from "./queries";

const COLUMNAS = ["Oportunidad", "Etapa", "Probabilidad", "Valor estimado", "Cierre estimado"];

function claseEtapa(o: Oportunidad) {
  if (o.etapa_clave === "ganada") return "bg-ok-bg text-ok";
  if (o.etapa_clave === "perdida") return "bg-danger-bg text-danger";
  return "bg-bg text-ink-2";
}

export function OportunidadesTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const [creando, setCreando] = useState(false);
  const [abiertaId, setAbiertaId] = useState<number | null>(null);

  const { data, isPending, isError } = useOportunidadesEmpresa(empresaId);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="text-sm font-bold">Oportunidades</div>
        {!creando && (
          <Button variant="outline" onClick={() => setCreando(true)}>
            Nueva oportunidad
          </Button>
        )}
      </div>
      {creando && <NuevaOportunidadForm empresaId={empresaId} contactos={contactos} onDone={() => setCreando(false)} />}

      {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-6 text-sm text-danger">No se pudieron cargar las oportunidades.</div>}
      {data && data.data.length === 0 && <div className="p-6 text-sm text-ink-3">Esta empresa no tiene oportunidades todavía.</div>}

      {data && data.data.length > 0 && (
        <div className="tabla-scroll"><table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {COLUMNAS.map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((o) => (
              <Fragment key={o.id}>
                <tr
                  className={`cursor-pointer border-t border-border hover:bg-bg ${abiertaId === o.id ? "bg-bg" : ""}`}
                  onClick={() => setAbiertaId(abiertaId === o.id ? null : o.id)}
                >
                  <td className="px-5 py-3 text-[13px] font-semibold">{o.titulo}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${claseEtapa(o)}`}>{o.etapa_nombre}</span>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{o.probabilidad}%</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{o.fecha_cierre_estimada ? formatoFecha.format(fechaLocal(o.fecha_cierre_estimada)) : "—"}</td>
                </tr>
                {abiertaId === o.id && (
                  <tr>
                    <td colSpan={COLUMNAS.length} className="p-0">
                      <OportunidadDetallePanel id={o.id} onClose={() => setAbiertaId(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
