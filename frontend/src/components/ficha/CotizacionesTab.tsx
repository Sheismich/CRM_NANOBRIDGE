import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { PanelLateral } from "../ui/PanelLateral";
import { Pastilla } from "../ui/Pastilla";
import { CuerpoCotizacion, EncabezadoCotizacion } from "../cotizaciones/CotizacionPanel";
import { api } from "../../lib/api";
import { ETIQUETA_ESTADO_COTIZACION, TONO_ESTADO_COTIZACION, avisoCotizacion, useMotivosRechazoCotizacion } from "../../lib/cotizaciones";
import { fechaLocal, formatoFecha, formatoMonedaEntera, plural } from "../../lib/formato";
import type { CotizacionDocumento, CotizacionTablero, Paginated } from "../../types";
import type { Tono } from "../ui/tonos";
import { CotizacionForm } from "./CotizacionForm";
import { useOportunidadesEmpresa } from "./queries";

const TEXTO_AVISO: Record<Tono, string> = { ok: "text-ok", warn: "text-warn", danger: "text-danger", info: "text-info", navy: "text-navy", neutro: "text-ink-3" };

// Cotizaciones de la empresa, con el estilo del tablero de Cotizaciones
// (folio, estado, el mismo aviso de seguimiento y el total). Al abrir una
// sale el mismo documento que en esa pantalla (CotizacionPanel), con sus
// acciones: así el rechazo siempre pide el motivo. La nueva versión se
// arma aquí arriba con el formulario de siempre y al guardarla se abre.
export function CotizacionesTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const [creando, setCreando] = useState(false);
  const [versionDe, setVersionDe] = useState<CotizacionDocumento | null>(null);
  const [abiertaId, setAbiertaId] = useState<number | null>(null);

  // Solo trae la versión vigente de cada cotización; un agente solo ve las
  // de sus oportunidades (CotizacionesService.list).
  const { data, isPending, isError } = useQuery({
    queryKey: ["cotizaciones", { empresaId }],
    queryFn: () => api.get<Paginated<CotizacionTablero>>("/api/v1/cotizaciones", { empresaId, limit: 100 })
  });
  const { data: oportunidades } = useOportunidadesEmpresa(empresaId);
  const tituloOportunidad = useMemo(() => new Map((oportunidades?.data ?? []).map((o) => [o.id, o.titulo])), [oportunidades]);
  const abiertas = useMemo(() => (oportunidades?.data ?? []).filter((o) => !o.cerrada), [oportunidades]);
  const { data: motivos } = useMotivosRechazoCotizacion();

  const filas = data?.data ?? [];
  const nombreMotivo = (clave: string) => motivos?.find((m) => m.clave === clave)?.nombre ?? clave;
  const enviadas = filas.filter((c) => c.estado === "enviada");

  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[14px] font-extrabold text-strong">Cotizaciones</h2>
          {filas.length > 0 && (
            <p className="text-[12px] text-ink-3">
              {plural(filas.length, "vigente", "vigentes")}
              {enviadas.length > 0 && ` · ${formatoMonedaEntera.format(enviadas.reduce((s, c) => s + Number(c.total), 0))} esperan respuesta`}
            </p>
          )}
        </div>
        {!creando && !versionDe && (
          <Button variant="outline" disabled={abiertas.length === 0} title={abiertas.length === 0 ? "Se cotiza contra una oportunidad abierta; esta empresa no tiene ninguna" : undefined} onClick={() => setCreando(true)}>
            + Nueva cotización
          </Button>
        )}
      </header>
      {creando && <CotizacionForm modo="crear" empresaId={empresaId} contactos={contactos} oportunidades={abiertas} onDone={() => setCreando(false)} onGuardada={setAbiertaId} />}
      {versionDe && <CotizacionForm key={versionDe.id} modo="version" base={versionDe} empresaId={empresaId} contactos={contactos} onDone={() => setVersionDe(null)} onGuardada={setAbiertaId} />}

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las cotizaciones.</div>}
      {data && filas.length === 0 && <div className="p-5 text-sm text-ink-3">Esta empresa no tiene cotizaciones todavía.</div>}

      {filas.length > 0 && (
        <ul className="divide-y divide-border">
          {filas.map((c) => {
            const aviso = avisoCotizacion(c, nombreMotivo);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setAbiertaId(c.id)}
                  className={clsx(
                    "grid w-full grid-cols-[56px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-soft md:grid-cols-[64px_minmax(0,1fr)_120px_minmax(0,200px)_130px] md:px-5",
                    abiertaId === c.id && "bg-soft"
                  )}
                >
                  <span className="row-span-2 md:row-span-1">
                    <b className="mono block font-display text-[17px] font-normal text-strong">#{c.id}</b>
                    <small className="text-[11px] font-bold text-ink-3">v{c.version}</small>
                  </span>
                  <span className="min-w-0">
                    <b className="block truncate text-[14px] text-strong">{tituloOportunidad.get(c.oportunidad_id) ?? c.oportunidad_titulo ?? `Oportunidad #${c.oportunidad_id}`}</b>
                    <small className="text-[12px] text-ink-3">Emitida {formatoFecha.format(fechaLocal(c.fecha_emision))}</small>
                  </span>
                  <span className="justify-self-end md:justify-self-start">
                    <Pastilla tono={TONO_ESTADO_COTIZACION[c.estado]} punto>
                      {ETIQUETA_ESTADO_COTIZACION[c.estado]}
                    </Pastilla>
                  </span>
                  <span className={clsx("min-w-0 truncate text-[12px] font-bold", TEXTO_AVISO[aviso.tono])}>{aviso.texto}</span>
                  <b className="mono justify-self-end font-display text-[18px] font-normal text-strong">{formatoMonedaEntera.format(Number(c.total))}</b>
                </button>
              </li>
            );
          })}
        </ul>
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
    </section>
  );
}
