import { useState } from "react";
import { Link } from "react-router-dom";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Pastilla } from "../ui/Pastilla";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_ESTADO_COTIZACION, TONO_ESTADO_COTIZACION } from "../../lib/cotizaciones";
import { fechaLocal, formatoDiaMes, formatoFecha, formatoFechaHora, formatoMonedaEntera, plural } from "../../lib/formato";
import type { CatalogosOportunidad, CotizacionTablero, OportunidadDetalle, OportunidadTablero, Paginated } from "../../types";


// Mismas reglas que cambiarEtapaSchema (src/comercial/dto/oportunidad.schema.ts):
// perder exige motivo, y el motivo "otro" exige explicación.
const cambiarEtapaSchema = z
  .object({
    etapaClave: z.string().min(1, "Elige una etapa"),
    motivoPerdidaClave: z.string(),
    motivoPerdidaDetalle: z.string().trim().max(500, "Máximo 500 caracteres").refine((v) => v === "" || v.length >= 2, "Mínimo 2 caracteres"),
    comentario: z.string().trim().max(500, "Máximo 500 caracteres")
  })
  .refine((v) => v.etapaClave !== "perdida" || v.motivoPerdidaClave !== "", { message: "Elige el motivo de pérdida", path: ["motivoPerdidaClave"] })
  .refine((v) => v.etapaClave !== "perdida" || v.motivoPerdidaClave !== "otro" || v.motivoPerdidaDetalle.length >= 2, {
    message: "Explica el motivo",
    path: ["motivoPerdidaDetalle"]
  });
type CambiarEtapaInput = z.infer<typeof cambiarEtapaSchema>;

const reabrirSchema = z.object({
  etapaClave: z.string().min(1, "Elige una etapa"),
  comentario: z.string().trim().max(500, "Máximo 500 caracteres")
});
type ReabrirInput = z.infer<typeof reabrirSchema>;

// `enPanel`: dentro de un PanelLateral (Oportunidades), que ya trae título y
// botón de cerrar: sin la caja gris ni el encabezado propio.
// `tarjeta`: la fila del tablero que se abrió; de ahí sale el nombre del
// responsable, que GET /oportunidades/:id no trae.
export function OportunidadDetallePanel({ id, onClose, enPanel = false, tarjeta }: { id: number; onClose: () => void; enPanel?: boolean; tarjeta?: OportunidadTablero }) {
  const { data: oportunidad, isPending, isError } = useQuery({
    queryKey: ["oportunidad", id],
    queryFn: () => api.get<OportunidadDetalle>(`/api/v1/oportunidades/${id}`)
  });
  const { data: catalogos } = useQuery({
    queryKey: ["oportunidades-catalogos"],
    queryFn: () => api.get<CatalogosOportunidad>("/api/v1/oportunidades/catalogos"),
    staleTime: Infinity
  });

  return (
    <div className={enPanel ? "px-4 py-5 md:px-5" : "border-t border-border bg-bg p-5"}>
      <div className={enPanel ? "mb-4 text-[13px] text-ink-2" : "mb-4 flex items-start justify-between"}>
        <div>
          {!enPanel && <div className="text-sm font-bold">{oportunidad?.titulo ?? "Oportunidad"}</div>}
          {oportunidad && (
            <div className="text-xs text-ink-3">
              {oportunidad.etapa_nombre} · {oportunidad.cerrada ? "Cerrada" : "Abierta"}
              {oportunidad.motivo_perdida_detalle && ` · ${oportunidad.motivo_perdida_detalle}`}
            </div>
          )}
        </div>
        {!enPanel && (
          <Button variant="ghost" onClick={onClose}>
            Cerrar detalle
          </Button>
        )}
      </div>

      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar la oportunidad.</div>}

      {oportunidad && <ResumenOportunidad oportunidad={oportunidad} responsableNombre={tarjeta?.responsable_nombre} />}
      {oportunidad && <CotizacionesDeOportunidad oportunidad={oportunidad} />}

      {oportunidad && catalogos && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Historial de etapas</div>
            <ol className="flex flex-col gap-2.5">
              {[...oportunidad.historial].reverse().map((h) => (
                <li key={h.id} className="rounded-[9px] border border-border bg-card px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{h.etapa_nombre}</span>
                    <span className="text-xs text-ink-3">{formatoFechaHora.format(new Date(h.creado_en))}</span>
                  </div>
                  {h.comentario && <div className="mt-0.5 text-xs text-ink-2">{h.comentario}</div>}
                </li>
              ))}
            </ol>
          </div>

          <div>
            {!oportunidad.cerrada && <CambiarEtapaForm oportunidad={oportunidad} catalogos={catalogos} />}
            {oportunidad.etapa_clave === "perdida" && <ReabrirForm oportunidad={oportunidad} catalogos={catalogos} />}
            {oportunidad.etapa_clave === "ganada" && <div className="text-[13px] text-ink-2">Oportunidad ganada: queda cerrada y no se reabre.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// Los datos del negocio arriba del historial (revisión del 15-oct: el panel
// solo enseñaba la etapa). Los días en la etapa salen del historial del
// detalle y no de la tarjeta, para que se reinicien en cuanto cambia.
function ResumenOportunidad({ oportunidad: o, responsableNombre }: { oportunidad: OportunidadDetalle; responsableNombre?: string | null }) {
  const valor = o.valor_estimado == null ? null : Number(o.valor_estimado);
  const entro = [...o.historial].reverse().find((h) => h.etapa_clave === o.etapa_clave);
  const dias = entro ? diasCompletosDesde(entro.creado_en) : null;
  const c = textoCierre(o.fecha_cierre_estimada, o.cerrada);

  return (
    <div className="mb-5 grid grid-cols-2 gap-2.5">
      <Dato etiqueta="Valor" valor={valor == null ? "Sin valor" : formatoMonedaEntera.format(valor)} />
      <Dato
        etiqueta="Ponderado"
        valor={valor == null ? "—" : formatoMonedaEntera.format((valor * o.probabilidad) / 100)}
        detalle={`${o.probabilidad}% por estar en ${o.etapa_nombre}`}
      />
      <Dato etiqueta="Cierre estimado" valor={c.fecha} detalle={c.detalle} claseDetalle={c.clase} />
      <Dato
        etiqueta="Responsable"
        valor={responsableNombre ?? (o.responsable_id == null ? "Sin responsable" : "—")}
        detalle={o.cerrada || dias == null ? undefined : `${plural(dias, "día", "días")} en la etapa`}
      />
    </div>
  );
}

// Igual que dias_en_etapa del backend: días completos (entró hace 30 horas = 1).
function diasCompletosDesde(fecha: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 86_400_000));
}

function Dato({ etiqueta, valor, detalle, claseDetalle }: { etiqueta: string; valor: string; detalle?: string; claseDetalle?: string }) {
  return (
    <div className="rounded-[12px] border border-border bg-card px-3.5 py-3">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3">{etiqueta}</div>
      <div className="mt-1 font-heading text-[18px] font-black text-strong">{valor}</div>
      {detalle && <div className={clsx("mt-0.5 text-[12px]", claseDetalle ?? "text-ink-3")}>{detalle}</div>}
    </div>
  );
}

// Mismo criterio que la tarjeta del tablero: vencida en rojo, este mes en ámbar.
function textoCierre(fecha: string | null, cerrada: boolean) {
  if (!fecha) return { fecha: "Sin fecha", detalle: undefined, clase: undefined };
  const f = fechaLocal(fecha);
  if (cerrada) return { fecha: formatoFecha.format(f), detalle: undefined, clase: undefined };
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((f.getTime() - hoy.getTime()) / 86_400_000);
  if (dias < 0) return { fecha: formatoFecha.format(f), detalle: `⚠ venció hace ${plural(-dias, "día", "días")}`, clase: "text-danger" };
  if (dias === 0) return { fecha: formatoFecha.format(f), detalle: "cierra hoy", clase: "text-warn" };
  const esteMes = f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
  return { fecha: formatoFecha.format(f), detalle: `faltan ${plural(dias, "día", "días")}`, clase: esteMes ? "text-warn" : undefined };
}

// Las cotizaciones del negocio (GET /cotizaciones?oportunidadId=; las
// obsoletas no salen, se ven en "Versiones" del documento). Se abren desde la
// ficha de la empresa, que ya tiene el documento completo.
function CotizacionesDeOportunidad({ oportunidad: o }: { oportunidad: OportunidadDetalle }) {
  const { data, isPending } = useQuery({
    queryKey: ["cotizaciones", { oportunidadId: o.id }],
    queryFn: () => api.get<Paginated<CotizacionTablero>>("/api/v1/cotizaciones", { oportunidadId: o.id, limit: 100 })
  });
  const cotizaciones = data?.data ?? [];

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-2">Cotizaciones{cotizaciones.length > 0 && ` · ${cotizaciones.length}`}</span>
        <Link to={`/empresas/${o.empresa_id}?tab=cotizaciones`} className="text-[12px] font-semibold text-navy hover:underline">
          Ver en la ficha ›
        </Link>
      </div>
      {isPending && <div className="text-[13px] text-ink-3">Cargando…</div>}
      {!isPending && cotizaciones.length === 0 && <div className="rounded-[9px] border border-dashed border-border px-3 py-2.5 text-[13px] text-ink-3">Todavía no tiene cotizaciones.</div>}
      {cotizaciones.length > 0 && (
        <ul className="flex flex-col gap-2">
          {cotizaciones.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 rounded-[9px] border border-border bg-card px-3 py-2">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-strong">
                  Versión {c.version} · {formatoMonedaEntera.format(Number(c.total))}
                </div>
                <div className="text-[12px] text-ink-3">{formatoDiaMes.format(fechaLocal(c.fecha_emision))}</div>
              </div>
              <Pastilla tono={TONO_ESTADO_COTIZACION[c.estado]} punto>
                {ETIQUETA_ESTADO_COTIZACION[c.estado]}
              </Pastilla>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function useRefrescar(id: number) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["oportunidad", id] }), queryClient.invalidateQueries({ queryKey: ["oportunidades"] })]);
  };
}

function CambiarEtapaForm({ oportunidad, catalogos }: { oportunidad: OportunidadDetalle; catalogos: CatalogosOportunidad }) {
  const refrescar = useRefrescar(oportunidad.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting }
  } = useForm<CambiarEtapaInput>({
    resolver: zodResolver(cambiarEtapaSchema),
    defaultValues: { etapaClave: "", motivoPerdidaClave: "", motivoPerdidaDetalle: "", comentario: "" }
  });
  const etapaClave = useWatch({ control, name: "etapaClave" });
  const motivoClave = useWatch({ control, name: "motivoPerdidaClave" });

  async function onSubmit(values: CambiarEtapaInput) {
    setServerError(null);
    const perdida = values.etapaClave === "perdida";
    try {
      await api.patch(`/api/v1/oportunidades/${oportunidad.id}/etapa`, {
        etapaClave: values.etapaClave,
        motivoPerdidaClave: perdida ? values.motivoPerdidaClave : undefined,
        motivoPerdidaDetalle: perdida && values.motivoPerdidaDetalle ? values.motivoPerdidaDetalle : undefined,
        comentario: values.comentario || undefined
      });
      reset();
      await refrescar();
    } catch (error) {
      // 409: alguien más la cerró o la cambió mientras tanto.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-3">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-2">Cambiar etapa</div>
      <Field label="Nueva etapa" htmlFor="etapa-nueva" error={errors.etapaClave?.message}>
        <select id="etapa-nueva" className={inputClass} {...register("etapaClave")}>
          <option value="">— Elige —</option>
          {catalogos.etapas
            .filter((e) => e.clave !== oportunidad.etapa_clave)
            .map((e) => (
              <option key={e.clave} value={e.clave}>
                {e.nombre} ({e.probabilidad}%)
              </option>
            ))}
        </select>
      </Field>

      {etapaClave === "perdida" && (
        <>
          <Field label="Motivo de pérdida" htmlFor="etapa-motivo" error={errors.motivoPerdidaClave?.message}>
            <select id="etapa-motivo" className={inputClass} {...register("motivoPerdidaClave")}>
              <option value="">— Elige —</option>
              {catalogos.motivos_perdida.map((m) => (
                <option key={m.clave} value={m.clave}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label={motivoClave === "otro" ? "Explicación" : "Explicación (opcional)"}
            htmlFor="etapa-detalle"
            error={errors.motivoPerdidaDetalle?.message}
          >
            <input id="etapa-detalle" className={inputClass} {...register("motivoPerdidaDetalle")} />
          </Field>
        </>
      )}

      {(etapaClave === "ganada" || etapaClave === "perdida") && (
        <div className="rounded-[9px] bg-warn-bg px-3 py-2 text-xs text-warn">
          {etapaClave === "ganada" ? "Una oportunidad ganada queda cerrada y ya no se puede reabrir." : "La oportunidad queda cerrada; se puede reabrir después."}
        </div>
      )}

      <Field label="Comentario (opcional)" htmlFor="etapa-comentario" error={errors.comentario?.message}>
        <input id="etapa-comentario" className={inputClass} {...register("comentario")} />
      </Field>

      <ServerError message={serverError} />
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Cambiar etapa"}
        </Button>
      </div>
    </form>
  );
}

// Solo una perdida se reabre (OportunidadesService.reabrir), y a una etapa
// abierta.
function ReabrirForm({ oportunidad, catalogos }: { oportunidad: OportunidadDetalle; catalogos: CatalogosOportunidad }) {
  const refrescar = useRefrescar(oportunidad.id);
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<ReabrirInput>({ resolver: zodResolver(reabrirSchema), defaultValues: { etapaClave: "", comentario: "" } });

  async function onSubmit(values: ReabrirInput) {
    setServerError(null);
    try {
      await api.patch(`/api/v1/oportunidades/${oportunidad.id}/reabrir`, { etapaClave: values.etapaClave, comentario: values.comentario || undefined });
      await refrescar();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-3">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-2">Reabrir oportunidad</div>
      <Field label="Reabrir en la etapa" htmlFor="reabrir-etapa" error={errors.etapaClave?.message}>
        <select id="reabrir-etapa" className={inputClass} {...register("etapaClave")}>
          <option value="">— Elige —</option>
          {catalogos.etapas
            .filter((e) => !e.es_cierre)
            .map((e) => (
              <option key={e.clave} value={e.clave}>
                {e.nombre} ({e.probabilidad}%)
              </option>
            ))}
        </select>
      </Field>
      <Field label="Comentario (opcional)" htmlFor="reabrir-comentario" error={errors.comentario?.message}>
        <input id="reabrir-comentario" placeholder="Ej. Volvió a pedir cotización" className={inputClass} {...register("comentario")} />
      </Field>
      <ServerError message={serverError} />
      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Reabriendo…" : "Reabrir"}
        </Button>
      </div>
    </form>
  );
}
