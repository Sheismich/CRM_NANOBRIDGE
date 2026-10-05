import { Fragment, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Field, ServerError, inputBaseClass, inputClass } from "../ui/Field";
import { Paginacion } from "../ui/Paginacion";
import { ApiError, api } from "../../lib/api";
import { fechaLocal, formatoFecha } from "../../lib/formato";
import { ACCIONES_CAMPANA, CLASE_ESTADO_CAMPANA, ETIQUETA_ESTADO_CAMPANA, ETIQUETA_MOTIVO_CAMPANA, type Campana, type EstadoCampana } from "../../lib/campanas";
import type { Paginated } from "../../types";

// Campañas (src/campanas/campanas.controller.ts): todos ven la lista; solo
// administrador y supervisor crean, editan, activan, pausan y finalizan.
// Cada campaña nace en borrador; "activa hoy" y el motivo cuando no lo está
// los calcula el backend con la misma regla que usa n8n (PT1 y PT4).

const LIMIT = 25;
const ETIQUETA_ACCION = { activar: "Activar", pausar: "Pausar", finalizar: "Finalizar" } as const;
type Accion = keyof typeof ETIQUETA_ACCION;

// Mismas reglas que crearCampanaSchema (src/campanas/dto/campana.schema.ts).
// Fecha vacía = sin fecha.
const campanaSchema = z
  .object({
    nombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
    fechaInicio: z.string(),
    fechaFin: z.string()
  })
  .refine((c) => !c.fechaInicio || !c.fechaFin || c.fechaInicio <= c.fechaFin, { message: "La fecha de fin no puede ser anterior a la de inicio", path: ["fechaFin"] });
type CampanaInput = z.infer<typeof campanaSchema>;

export function CampanasTab({ puedeEditar }: { puedeEditar: boolean }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState<EstadoCampana | "">("");
  const [creando, setCreando] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [confirmarFin, setConfirmarFin] = useState<number | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtros = { page, limit: LIMIT, estado: estado || undefined };
  const { data, isPending, isError } = useQuery({
    queryKey: ["campanas", filtros],
    queryFn: () => api.get<Paginated<Campana>>("/api/v1/campanas", filtros)
  });

  async function cambiarEstado(c: Campana, accion: Accion) {
    setError(null);
    setOcupadoId(c.id);
    try {
      await api.post(`/api/v1/campanas/${c.id}/${accion}`);
      setConfirmarFin(null);
    } catch (err) {
      // 409 TRANSICION_CAMPANA_INVALIDA (otra persona la cambió antes) o
      // CAMPANA_VENCIDA (activar con la fecha de fin ya pasada).
      setError(err instanceof ApiError ? `${c.nombre}: ${err.message}` : "No se pudo conectar con el servidor");
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["campanas"] });
      setOcupadoId(null);
    }
  }

  const columnas = ["Campaña", "Estado", "¿Manda hoy?", "Inicio", "Fin", "Prospectos", ""];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <select
          aria-label="Estado"
          className={`${inputBaseClass} w-auto`}
          value={estado}
          onChange={(e) => {
            setPage(1);
            setEstado(e.target.value as EstadoCampana | "");
          }}
        >
          <option value="">Estado: Todas</option>
          {(Object.keys(ETIQUETA_ESTADO_CAMPANA) as EstadoCampana[]).map((e) => (
            <option key={e} value={e}>
              {ETIQUETA_ESTADO_CAMPANA[e]}
            </option>
          ))}
        </select>
        {puedeEditar && !creando && (
          <Button
            onClick={() => {
              setCreando(true);
              setEditandoId(null);
            }}
          >
            + Nueva campaña
          </Button>
        )}
      </div>

      {creando && <CampanaForm onDone={() => setCreando(false)} />}
      {error && (
        <div className="px-5 pb-3">
          <ServerError message={error} />
        </div>
      )}

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las campañas.</div>}
      {data && data.data.length === 0 && (
        <div className="p-5 text-sm text-ink-3">{estado ? "No hay campañas con ese estado." : "Todavía no hay campañas. Sin una campaña activa, la automatización no manda correos de prospección."}</div>
      )}

      {data && data.data.length > 0 && (
        <div className="tabla-scroll">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {columnas.map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <Fragment key={c.id}>
                  <tr className="border-t border-border align-top">
                    <td className="px-5 py-3 text-[13px] font-semibold">
                      {c.nombre}
                      <div className="text-xs font-normal text-ink-3">#{c.id} · {c.canal === "whatsapp" ? "WhatsApp" : "Correo"}</div>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CLASE_ESTADO_CAMPANA[c.estado]}`}>{ETIQUETA_ESTADO_CAMPANA[c.estado]}</span>
                    </td>
                    <td className="px-5 py-3 text-[13px]">
                      {c.activa_hoy ? <span className="font-semibold text-ok">Sí</span> : <span className="text-ink-3">{c.motivo ? ETIQUETA_MOTIVO_CAMPANA[c.motivo] : "No"}</span>}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-ink-2">{c.fecha_inicio ? formatoFecha.format(fechaLocal(c.fecha_inicio)) : "—"}</td>
                    <td className="px-5 py-3 text-[13px] text-ink-2">{c.fecha_fin ? formatoFecha.format(fechaLocal(c.fecha_fin)) : "—"}</td>
                    <td className="px-5 py-3 text-[13px] text-ink-2">{c.prospectos}</td>
                    <td className="px-5 py-3">
                      {puedeEditar && c.estado !== "finalizada" && (
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {confirmarFin === c.id ? (
                            <>
                              <span className="self-center text-xs text-danger">Es definitivo: sus recordatorios se cancelan.</span>
                              <Button variant="peligro" className="border border-border px-3 py-1.5" disabled={ocupadoId === c.id} onClick={() => void cambiarEstado(c, "finalizar")}>
                                Sí, finalizar
                              </Button>
                              <Button variant="ghost" className="px-3 py-1.5" onClick={() => setConfirmarFin(null)}>
                                No
                              </Button>
                            </>
                          ) : (
                            <>
                              {ACCIONES_CAMPANA[c.estado].map((accion) =>
                                accion === "finalizar" ? (
                                  <Button key={accion} variant="peligro" className="border border-border px-3 py-1.5" disabled={ocupadoId === c.id} onClick={() => setConfirmarFin(c.id)}>
                                    Finalizar
                                  </Button>
                                ) : (
                                  <Button key={accion} variant={accion === "activar" ? "exito" : "outline"} className="px-3 py-1.5" disabled={ocupadoId === c.id} onClick={() => void cambiarEstado(c, accion)}>
                                    {ETIQUETA_ACCION[accion]}
                                  </Button>
                                )
                              )}
                              <Button
                                variant="ghost"
                                className="border border-border px-3 py-1.5"
                                onClick={() => {
                                  setEditandoId(editandoId === c.id ? null : c.id);
                                  setCreando(false);
                                }}
                              >
                                {editandoId === c.id ? "Cancelar" : "Editar"}
                              </Button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                  {editandoId === c.id && (
                    <tr>
                      <td colSpan={columnas.length} className="p-0">
                        <CampanaForm campana={c} onDone={() => setEditandoId(null)} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
    </Card>
  );
}

function CampanaForm({ campana, onDone }: { campana?: Campana; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields }
  } = useForm<CampanaInput>({
    resolver: zodResolver(campanaSchema),
    defaultValues: { nombre: campana?.nombre ?? "", fechaInicio: campana?.fecha_inicio ?? "", fechaFin: campana?.fecha_fin ?? "" }
  });

  async function onSubmit(values: CampanaInput) {
    setServerError(null);
    try {
      if (campana) {
        // PATCH parcial: solo lo que cambió; una fecha vaciada se manda como
        // null para quitarla.
        const cambios: Record<string, string | null> = {};
        if (dirtyFields.nombre) cambios.nombre = values.nombre;
        if (dirtyFields.fechaInicio) cambios.fechaInicio = values.fechaInicio || null;
        if (dirtyFields.fechaFin) cambios.fechaFin = values.fechaFin || null;
        if (Object.keys(cambios).length === 0) return onDone();
        await api.patch(`/api/v1/campanas/${campana.id}`, cambios);
      } else {
        await api.post("/api/v1/campanas", {
          nombre: values.nombre,
          canal: "correo",
          ...(values.fechaInicio ? { fechaInicio: values.fechaInicio } : {}),
          ...(values.fechaFin ? { fechaFin: values.fechaFin } : {})
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["campanas"] });
      onDone();
    } catch (error) {
      // 409 CAMPANA_VENCIDA: fecha de fin pasada en una activa o pausada;
      // 409 CAMPANA_FINALIZADA: alguien la finalizó mientras se editaba.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-y border-border bg-bg p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Nombre" htmlFor="cmp-nombre" error={errors.nombre?.message}>
          <input id="cmp-nombre" className={inputClass} {...register("nombre")} />
        </Field>
        <Field label="Fecha de inicio (opcional)" htmlFor="cmp-inicio" error={errors.fechaInicio?.message}>
          <input id="cmp-inicio" type="date" className={inputClass} {...register("fechaInicio")} />
        </Field>
        <Field label="Fecha de fin (opcional)" htmlFor="cmp-fin" error={errors.fechaFin?.message}>
          <input id="cmp-fin" type="date" className={inputClass} {...register("fechaFin")} />
        </Field>
      </div>
      {!campana && <div className="text-xs text-ink-3">Solo canal correo. La campaña nace en borrador: no manda nada hasta que la actives.</div>}
      <ServerError message={serverError} />
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {campana ? "Guardar cambios" : "Crear campaña"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
