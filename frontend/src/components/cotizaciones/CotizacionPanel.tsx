import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Modal } from "../ui/Modal";
import { Pastilla } from "../ui/Pastilla";
import { HojaCotizacion } from "./HojaCotizacion";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_ESTADO_COTIZACION, PUEDE_ENVIARSE, PUEDE_RESPONDERSE, PUEDE_VERSIONARSE, TONO_ESTADO_COTIZACION, diasDesde, hojaDeCotizacion, useCotizacion, useMotivosRechazoCotizacion } from "../../lib/cotizaciones";
import { formatoMoneda, plural } from "../../lib/formato";
import type { CotizacionDocumento, MotivoRechazoCotizacion } from "../../types";

// Panel de una cotización (docs/diseno/cotizaciones.html, "clic abre la
// cotización como documento"). El encabezado (fijo en el PanelLateral)
// trae el estado y lo que se puede hacer; el cuerpo, la hoja y sus
// versiones. Los dos leen la misma consulta (useCotizacion).

export function EncabezadoCotizacion({ id, onNuevaVersion }: { id: number; onNuevaVersion: (base: CotizacionDocumento) => void }) {
  const queryClient = useQueryClient();
  const { data: c } = useCotizacion(id);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [porAceptar, setPorAceptar] = useState(false);
  const [porRechazar, setPorRechazar] = useState(false);

  async function cambiarEstado(cuerpo: { estado: string; motivoRechazo?: string; motivoRechazoDetalle?: string }) {
    setError(null);
    setGuardando(true);
    try {
      await api.patch(`/api/v1/cotizaciones/${id}/estado`, cuerpo);
    } catch (err) {
      // 409: otra persona la cambió, la oportunidad ya se cerró o ya hay
      // otra aceptada en la misma oportunidad. El mensaje del backend lo dice.
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["cotizacion", id] }),
        queryClient.invalidateQueries({ queryKey: ["cotizaciones"] }),
        // Aceptar gana la oportunidad (15-oct-2026): tablero, panel y reportes cambian.
        ...(cuerpo.estado === "aceptada"
          ? [queryClient.invalidateQueries({ queryKey: ["oportunidades"] }), queryClient.invalidateQueries({ queryKey: ["oportunidad"] }), queryClient.invalidateQueries({ queryKey: ["reportes"] })]
          : [])
      ]);
      setGuardando(false);
    }
  }

  async function descargarPdf() {
    setError(null);
    try {
      await api.descargar(`/api/v1/cotizaciones/${id}/pdf`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo descargar el PDF");
    }
  }

  if (!c) return <div className="pt-1.5 text-[13px] text-ink-2">Cargando…</div>;

  const hace = c.estado === "enviada" && c.fecha_envio ? diasDesde(c.fecha_envio) : null;
  const anterior = c.versiones.find((v) => v.version === c.version - 1);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Pastilla tono={TONO_ESTADO_COTIZACION[c.estado]} punto className="!text-[12px]">
          {ETIQUETA_ESTADO_COTIZACION[c.estado]}
          {hace != null && ` · ${hace === 0 ? "hoy" : `hace ${plural(hace, "día", "días")}`}`}
        </Pastilla>
        <Pastilla>{anterior ? `v${c.version} · reemplaza a v${anterior.version}` : `v${c.version}`}</Pastilla>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {PUEDE_ENVIARSE(c.estado) && (
          <Button className="!px-3 !py-2 !text-[12px]" disabled={guardando} onClick={() => void cambiarEstado({ estado: "enviada" })}>
            <Icono nombre="correo" size={14} /> Marcar enviada
          </Button>
        )}
        {PUEDE_RESPONDERSE(c.estado) && (
          <>
            <Button variant="aprobar" className="!px-3 !py-2 !text-[12px]" disabled={guardando} onClick={() => setPorAceptar(true)}>
              <Icono nombre="check" size={14} /> Aceptada
            </Button>
            <Button variant="rechazar" className="!px-3 !py-2 !text-[12px]" disabled={guardando} onClick={() => setPorRechazar(true)}>
              Rechazada
            </Button>
          </>
        )}
        {PUEDE_VERSIONARSE(c.estado) && (
          <Button variant="outline" className="!px-3 !py-2 !text-[12px]" onClick={() => onNuevaVersion(c)}>
            Nueva versión
          </Button>
        )}
        <Button variant="outline" className="!px-3 !py-2 !text-[12px]" onClick={() => void descargarPdf()}>
          <Icono nombre="descargar" size={14} /> PDF
        </Button>
      </div>
      <ServerError message={error} />

      <Modal
        abierto={porAceptar}
        onCerrar={() => setPorAceptar(false)}
        titulo="¿El cliente la aceptó?"
        descripcion={`La #${c.id} v${c.version} por ${formatoMoneda.format(Number(c.total))} queda aceptada y ya no se le pueden sacar versiones. Su oportunidad pasa a Ganada con ese total como valor, y queda cerrada.`}
        acciones={
          <>
            <Button variant="ghost" onClick={() => setPorAceptar(false)}>
              Todavía no
            </Button>
            <Button
              variant="aprobar"
              onClick={() => {
                setPorAceptar(false);
                void cambiarEstado({ estado: "aceptada" });
              }}
            >
              Sí, aceptada
            </Button>
          </>
        }
      />
      <Modal abierto={porRechazar} onCerrar={() => setPorRechazar(false)} titulo="¿Por qué la rechazó?" descripcion={`La #${c.id} v${c.version} queda rechazada. Si se le manda otra propuesta, se saca una versión nueva.`}>
        <MotivoRechazo
          onCancelar={() => setPorRechazar(false)}
          onConfirmar={(motivo, detalle) => {
            setPorRechazar(false);
            void cambiarEstado({ estado: "rechazada", motivoRechazo: motivo, motivoRechazoDetalle: detalle || undefined });
          }}
        />
      </Modal>
    </div>
  );
}

export function CuerpoCotizacion({ id, onVerVersion }: { id: number; onVerVersion: (id: number) => void }) {
  const { data: c, isPending, isError } = useCotizacion(id);
  const { data: motivos } = useMotivosRechazoCotizacion();

  if (isPending) return <div className="p-5 text-sm text-ink-2">Cargando…</div>;
  if (isError || !c) return <div className="p-5 text-sm text-danger">No se pudo cargar la cotización.</div>;

  const motivo = c.motivo_rechazo ? (motivos?.find((m) => m.clave === c.motivo_rechazo)?.nombre ?? c.motivo_rechazo) : null;
  return (
    <div className="pb-6">
      {c.estado === "rechazada" && (
        <div className="mx-3 mt-3 rounded-[12px] border border-danger/25 bg-danger-bg px-4 py-3 text-[13px] text-danger md:mx-[22px] md:mt-[22px]">
          <b>Motivo del rechazo: {motivo ?? "sin registrar"}</b>
          {c.motivo_rechazo_detalle && <p className="mt-0.5 text-ink-2">{c.motivo_rechazo_detalle}</p>}
        </div>
      )}
      {c.estado === "obsoleta" && (
        <div className="mx-3 mt-3 rounded-[12px] border border-dashed border-border bg-card px-4 py-3 text-[13px] text-ink-2 md:mx-[22px] md:mt-[22px]">
          Esta versión ya se reemplazó. Abre la más nueva abajo, en Versiones.
        </div>
      )}
      <HojaCotizacion datos={hojaDeCotizacion(c)} />

      <div className="mx-3 flex flex-col gap-3 md:mx-[22px]">
        {c.versiones.length > 1 && (
          <div>
            <div className="mb-1.5 font-heading text-[11px] font-extrabold uppercase tracking-[1.5px] text-ink-3">Versiones</div>
            <div className="flex flex-wrap gap-1.5">
              {c.versiones.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onVerVersion(v.id)}
                  aria-current={v.id === c.id}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-[12px] font-bold",
                    v.id === c.id ? "border-navy bg-navy-bg text-navy" : "border-border bg-card text-ink-2 hover:text-strong"
                  )}
                >
                  v{v.version} · {ETIQUETA_ESTADO_COTIZACION[v.estado]} · {formatoMoneda.format(Number(v.total))}
                </button>
              ))}
            </div>
          </div>
        )}
        <Link to={`/empresas/${c.empresa_id}?tab=cotizaciones`} className="self-start text-[13px] font-bold text-navy hover:underline">
          Ver todas las de {c.empresa_nombre ?? "la empresa"} ›
        </Link>
      </div>
    </div>
  );
}

// Motivo de rechazo: siempre se pide en el front (decisión del 12-oct;
// el backend lo vuelve obligatorio el día del cambio). "Otro" necesita
// explicación, igual que valida el backend.
function MotivoRechazo({ onCancelar, onConfirmar }: { onCancelar: () => void; onConfirmar: (motivo: MotivoRechazoCotizacion, detalle: string) => void }) {
  const { data: motivos, isError } = useMotivosRechazoCotizacion();
  const [motivo, setMotivo] = useState<MotivoRechazoCotizacion | "">("");
  const [detalle, setDetalle] = useState("");
  const [intento, setIntento] = useState(false);
  const errorMotivo = !motivo ? "Elige el motivo" : undefined;
  // El backend pide al menos 2 letras cuando llega el detalle.
  const errorDetalle = (motivo === "otro" || detalle.trim() !== "") && detalle.trim().length < 2 ? "Explica el motivo" : undefined;

  return (
    <form
      className="flex flex-col gap-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        setIntento(true);
        if (motivo && !errorDetalle) onConfirmar(motivo, detalle.trim());
      }}
    >
      {isError && <ServerError message="No se pudieron cargar los motivos." />}
      <div className="flex flex-wrap gap-1.5">
        {(motivos ?? []).map((m) => (
          <button
            key={m.clave}
            type="button"
            onClick={() => setMotivo(m.clave)}
            aria-pressed={motivo === m.clave}
            className={clsx("rounded-full border px-3 py-1.5 text-[12px] font-bold", motivo === m.clave ? "border-danger bg-danger-bg text-danger" : "border-border bg-card text-ink-2 hover:text-strong")}
          >
            {m.nombre}
          </button>
        ))}
      </div>
      {intento && errorMotivo && <span className="text-xs text-danger">{errorMotivo}</span>}
      <Field label={motivo === "otro" ? "Explícalo" : "Detalle (opcional)"} htmlFor="rechazo-detalle" error={intento ? errorDetalle : undefined}>
        <textarea id="rechazo-detalle" rows={2} maxLength={500} className={inputClass} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2.5 pt-1">
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" variant="rechazar">
          Marcar rechazada
        </Button>
      </div>
    </form>
  );
}
