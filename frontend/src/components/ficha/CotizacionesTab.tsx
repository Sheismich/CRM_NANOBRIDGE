import { Fragment, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ServerError } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_ESTADO_COTIZACION, claseEstadoCotizacion } from "../../lib/cotizaciones";
import { fechaLocal, formatoFecha, formatoMoneda } from "../../lib/formato";
import type { Cotizacion, CotizacionDetalle, EstadoCotizacion, Paginated } from "../../types";
import { CotizacionForm } from "./CotizacionForm";
import { useOportunidadesEmpresa } from "./queries";

const COLUMNAS = ["Oportunidad", "Versión", "Total", "Estado", "Emitida", "Cierre esperado"];

// Mismas transiciones que TRANSICIONES en cotizaciones.service.ts:
// "obsoleta" nunca es destino manual, solo la fija una nueva versión.
const TRANSICIONES: Record<EstadoCotizacion, { estado: EstadoCotizacion; accion: string }[]> = {
  borrador: [{ estado: "enviada", accion: "Marcar enviada" }],
  enviada: [
    { estado: "aceptada", accion: "Aceptada" },
    { estado: "rechazada", accion: "Rechazada" },
    { estado: "vencida", accion: "Vencida" }
  ],
  aceptada: [],
  rechazada: [],
  vencida: [],
  obsoleta: []
};

export function CotizacionesTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const [creando, setCreando] = useState(false);
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
        {!creando && (
          <Button variant="outline" disabled={abiertas.length === 0} title={abiertas.length === 0 ? "Se cotiza contra una oportunidad abierta; esta empresa no tiene ninguna" : undefined} onClick={() => setCreando(true)}>
            Nueva cotización
          </Button>
        )}
      </div>
      {creando && <CotizacionForm modo="crear" empresaId={empresaId} contactos={contactos} oportunidades={abiertas} onDone={() => setCreando(false)} />}

      {isPending && <div className="p-6 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-6 text-sm text-danger">No se pudieron cargar las cotizaciones.</div>}
      {data && data.data.length === 0 && <div className="p-6 text-sm text-ink-3">Esta empresa no tiene cotizaciones todavía.</div>}

      {data && data.data.length > 0 && (
        <table className="w-full border-collapse">
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
              <Fragment key={c.id}>
                <tr className={`cursor-pointer border-t border-border hover:bg-bg ${abiertaId === c.id ? "bg-bg" : ""}`} onClick={() => setAbiertaId(abiertaId === c.id ? null : c.id)}>
                  <td className="px-5 py-3 text-[13px] font-semibold">{tituloOportunidad.get(c.oportunidad_id) ?? `Oportunidad #${c.oportunidad_id}`}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">v{c.version}</td>
                  <td className="px-5 py-3 text-[13px] font-semibold">{formatoMoneda.format(Number(c.total))}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${claseEstadoCotizacion(c.estado)}`}>{ETIQUETA_ESTADO_COTIZACION[c.estado]}</span>
                  </td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{formatoFecha.format(fechaLocal(c.fecha_emision))}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{c.fecha_esperada_cierre ? formatoFecha.format(fechaLocal(c.fecha_esperada_cierre)) : "—"}</td>
                </tr>
                {abiertaId === c.id && (
                  <tr>
                    <td colSpan={COLUMNAS.length} className="p-0">
                      <CotizacionDetallePanel
                        id={c.id}
                        empresaId={empresaId}
                        contactos={contactos}
                        onClose={() => setAbiertaId(null)}
                        // Una nueva versión tiene otro id: el detalle abierto pasa a ella.
                        onNuevaVersion={setAbiertaId}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

function CotizacionDetallePanel({
  id,
  empresaId,
  contactos,
  onClose,
  onNuevaVersion
}: {
  id: number;
  empresaId: number;
  contactos: { id: number; nombre: string }[];
  onClose: () => void;
  onNuevaVersion: (id: number) => void;
}) {
  const queryClient = useQueryClient();
  const [versionando, setVersionando] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const { data: cotizacion, isPending, isError } = useQuery({
    queryKey: ["cotizacion", id],
    queryFn: () => api.get<CotizacionDetalle>(`/api/v1/cotizaciones/${id}`)
  });

  async function cambiarEstado(estado: EstadoCotizacion) {
    setServerError(null);
    setGuardando(true);
    try {
      await api.patch(`/api/v1/cotizaciones/${id}/estado`, { estado });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["cotizacion", id] }), queryClient.invalidateQueries({ queryKey: ["cotizaciones"] })]);
    } catch (error) {
      // 409: alguien más cambió el estado mientras tanto.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    } finally {
      setGuardando(false);
    }
  }

  async function alTerminarVersion() {
    setVersionando(false);
    // La lista ya se refrescó (CotizacionForm): la versión vigente nueva es
    // la de la misma cadena que ya no es esta.
    const lista = queryClient.getQueryData<Paginated<Cotizacion>>(["cotizaciones", { empresaId }]);
    const raiz = cotizacion?.cotizacion_raiz_id ?? cotizacion?.id;
    const nueva = lista?.data.find((c) => (c.cotizacion_raiz_id ?? c.id) === raiz);
    if (nueva) onNuevaVersion(nueva.id);
  }

  return (
    <div className="border-t border-border bg-bg">
      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudo cargar la cotización.</div>}

      {cotizacion && versionando && (
        <CotizacionForm modo="version" base={cotizacion} empresaId={empresaId} contactos={contactos} onDone={() => void alTerminarVersion()} />
      )}

      {cotizacion && !versionando && (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between">
            <div className="text-xs text-ink-3">
              v{cotizacion.version} · {cotizacion.moneda}
              {cotizacion.fecha_envio && ` · Enviada el ${formatoFecha.format(fechaLocal(cotizacion.fecha_envio))}`}
              {cotizacion.probabilidad != null && ` · Probabilidad ${cotizacion.probabilidad}%`}
            </div>
            <Button variant="ghost" onClick={onClose}>
              Cerrar detalle
            </Button>
          </div>

          <table className="w-full border-collapse rounded-[9px] bg-white text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                <th className="px-3 py-2">Descripción</th>
                <th className="px-3 py-2 text-right">Cantidad</th>
                <th className="px-3 py-2 text-right">Precio unitario</th>
                <th className="px-3 py-2 text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {cotizacion.partidas.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{p.descripcion}</td>
                  <td className="px-3 py-2 text-right">{Number(p.cantidad)}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda.format(Number(p.precio_unitario))}</td>
                  <td className="px-3 py-2 text-right">{formatoMoneda.format(Number(p.importe))}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="flex flex-col items-end gap-0.5 text-[13px]">
            <span className="text-ink-2">Subtotal: {formatoMoneda.format(Number(cotizacion.subtotal))}</span>
            <span className="text-ink-2">Descuento: −{formatoMoneda.format(Number(cotizacion.descuento))}</span>
            <span className="text-ink-2">Impuestos: {formatoMoneda.format(Number(cotizacion.impuestos))}</span>
            <span className="font-bold">Total: {formatoMoneda.format(Number(cotizacion.total))}</span>
          </div>

          {cotizacion.versiones.length > 1 && (
            <div>
              <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-2">Versiones</div>
              <div className="flex flex-wrap gap-2">
                {cotizacion.versiones.map((v) => (
                  <span key={v.id} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${v.id === cotizacion.id ? "bg-navy text-white" : "bg-white text-ink-2"}`}>
                    v{v.version} · {ETIQUETA_ESTADO_COTIZACION[v.estado]} · {formatoMoneda.format(Number(v.total))}
                  </span>
                ))}
              </div>
            </div>
          )}

          <ServerError message={serverError} />

          <div className="flex flex-wrap justify-end gap-2">
            {cotizacion.estado !== "obsoleta" && (
              <Button variant="outline" onClick={() => setVersionando(true)}>
                Nueva versión
              </Button>
            )}
            {TRANSICIONES[cotizacion.estado].map((t) => (
              <Button key={t.estado} disabled={guardando} onClick={() => void cambiarEstado(t.estado)}>
                {t.accion}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
