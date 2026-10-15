import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { PanelLateral } from "../ui/PanelLateral";
import { Pastilla } from "../ui/Pastilla";
import { CuerpoCotizacion, EncabezadoCotizacion } from "../cotizaciones/CotizacionPanel";
import { api } from "../../lib/api";
import { ETIQUETA_ESTADO_COTIZACION, TONO_ESTADO_COTIZACION } from "../../lib/cotizaciones";
import { fechaLocal, formatoFecha, formatoMoneda } from "../../lib/formato";
import type { Cotizacion, CotizacionDocumento, Paginated } from "../../types";
import { CotizacionForm } from "./CotizacionForm";
import { useOportunidadesEmpresa } from "./queries";

const COLUMNAS = ["Oportunidad", "Versión", "Total", "Estado", "Emitida", "Cierre esperado"];

// Cotizaciones de la empresa. Al abrir una sale el mismo documento que en
// la pantalla Cotizaciones (CotizacionPanel), con sus acciones: así el
// rechazo siempre pide el motivo. La nueva versión se arma aquí arriba con
// el formulario de siempre y al guardarla se abre.
export function CotizacionesTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const [creando, setCreando] = useState(false);
  const [versionDe, setVersionDe] = useState<CotizacionDocumento | null>(null);
  const [abiertaId, setAbiertaId] = useState<number | null>(null);

  // Solo trae la versión vigente de cada cotización; un agente solo ve las
  // de sus oportunidades (CotizacionesService.list).
  const { data, isPending, isError } = useQuery({
    queryKey: ["cotizaciones", { empresaId }],
    queryFn: () => api.get<Paginated<Cotizacion>>("/api/v1/cotizaciones", { empresaId, limit: 100 })
  });
  const { data: oportunidades } = useOportunidadesEmpresa(empresaId);
  const tituloOportunidad = useMemo(() => new Map((oportunidades?.data ?? []).map((o) => [o.id, o.titulo])), [oportunidades]);
  const abiertas = useMemo(() => (oportunidades?.data ?? []).filter((o) => !o.cerrada), [oportunidades]);

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="text-sm font-bold">Cotizaciones</div>
        {!creando && !versionDe && (
          <Button variant="outline" disabled={abiertas.length === 0} title={abiertas.length === 0 ? "Se cotiza contra una oportunidad abierta; esta empresa no tiene ninguna" : undefined} onClick={() => setCreando(true)}>
            Nueva cotización
          </Button>
        )}
      </div>
      {creando && <CotizacionForm modo="crear" empresaId={empresaId} contactos={contactos} oportunidades={abiertas} onDone={() => setCreando(false)} onGuardada={setAbiertaId} />}
      {versionDe && <CotizacionForm key={versionDe.id} modo="version" base={versionDe} empresaId={empresaId} contactos={contactos} onDone={() => setVersionDe(null)} onGuardada={setAbiertaId} />}

      {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-6 text-sm text-danger">No se pudieron cargar las cotizaciones.</div>}
      {data && data.data.length === 0 && <div className="p-6 text-sm text-ink-3">Esta empresa no tiene cotizaciones todavía.</div>}

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
            {data.data.map((c) => (
              <tr key={c.id} className={`cursor-pointer border-t border-border hover:bg-bg ${abiertaId === c.id ? "bg-bg" : ""}`} onClick={() => setAbiertaId(c.id)}>
                <td className="px-5 py-3 text-[13px] font-semibold">
                  <span className="text-ink-3">#{c.id}</span> {tituloOportunidad.get(c.oportunidad_id) ?? `Oportunidad #${c.oportunidad_id}`}
                </td>
                <td className="px-5 py-3 text-[13px] text-ink-2">v{c.version}</td>
                <td className="px-5 py-3 text-[13px] font-semibold">{formatoMoneda.format(Number(c.total))}</td>
                <td className="px-5 py-3">
                  <Pastilla tono={TONO_ESTADO_COTIZACION[c.estado]} punto>
                    {ETIQUETA_ESTADO_COTIZACION[c.estado]}
                  </Pastilla>
                </td>
                <td className="px-5 py-3 text-[13px] text-ink-2">{formatoFecha.format(fechaLocal(c.fecha_emision))}</td>
                <td className="px-5 py-3 text-[13px] text-ink-2">{c.fecha_esperada_cierre ? formatoFecha.format(fechaLocal(c.fecha_esperada_cierre)) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}

      <PanelLateral
        abierto={abiertaId !== null}
        onCerrar={() => setAbiertaId(null)}
        ancho={860}
        encabezado={
          abiertaId !== null && (
            <EncabezadoCotizacion
              id={abiertaId}
              onNuevaVersion={(base) => {
                setAbiertaId(null);
                setCreando(false);
                setVersionDe(base);
              }}
            />
          )
        }
        cuerpoClassName="!p-0 bg-soft"
      >
        {abiertaId !== null && <CuerpoCotizacion id={abiertaId} onVerVersion={setAbiertaId} />}
      </PanelLateral>
    </Card>
  );
}
