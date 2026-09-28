import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import type { CatalogosOportunidad, OportunidadDetalle } from "../../types";

const formatoFecha = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

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

export function OportunidadDetallePanel({ id, onClose }: { id: number; onClose: () => void }) {
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
    <div className="border-t border-border bg-bg p-5">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <div className="text-sm font-bold">{oportunidad?.titulo ?? "Oportunidad"}</div>
          {oportunidad && (
            <div className="text-xs text-ink-3">
              {oportunidad.etapa_nombre} · {oportunidad.cerrada ? "Cerrada" : "Abierta"}
              {oportunidad.motivo_perdida_detalle && ` · ${oportunidad.motivo_perdida_detalle}`}
            </div>
          )}
        </div>
        <Button variant="ghost" onClick={onClose}>
          Cerrar detalle
        </Button>
      </div>

      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar la oportunidad.</div>}

      {oportunidad && catalogos && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Historial de etapas</div>
            <ol className="flex flex-col gap-2.5">
              {[...oportunidad.historial].reverse().map((h) => (
                <li key={h.id} className="rounded-[9px] border border-border bg-white px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-semibold">{h.etapa_nombre}</span>
                    <span className="text-xs text-ink-3">{formatoFecha.format(new Date(h.creado_en))}</span>
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
