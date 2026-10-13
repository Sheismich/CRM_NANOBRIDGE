import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Modal } from "../ui/Modal";
import { Pastilla } from "../ui/Pastilla";
import type { Tono } from "../ui/tonos";
import { Field, ServerError, inputBaseClass, inputClass } from "../ui/Field";
import { Paginacion } from "../ui/Paginacion";
import { ApiError, api } from "../../lib/api";
import { fechaLocal, formatoFecha } from "../../lib/formato";
import { ACCIONES_CAMPANA, ETIQUETA_ESTADO_CAMPANA, ETIQUETA_MOTIVO_CAMPANA, type Campana, type EstadoCampana } from "../../lib/campanas";
import type { CampanaProspeccion, Paginated, ReporteProspeccion } from "../../types";

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

export function CampanasTab({ puedeEditar, onVerProspectos }: { puedeEditar: boolean; onVerProspectos: (campanaId: number) => void }) {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [estado, setEstado] = useState<EstadoCampana | "">("");
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState<Campana | null>(null);
  const [confirmarFin, setConfirmarFin] = useState<Campana | null>(null);
  const [ocupadoId, setOcupadoId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtros = { page, limit: LIMIT, estado: estado || undefined };
  const { data, isPending, isError } = useQuery({
    queryKey: ["campanas", filtros],
    queryFn: () => api.get<Paginated<Campana>>("/api/v1/campanas", filtros)
  });
  // Contactadas / respondieron / interesados de cada campaña. Es un
  // reporte (solo administrador y supervisor, los mismos que editan): un
  // agente ve las tarjetas sin esos números.
  const { data: prospeccion } = useQuery({
    queryKey: ["reportes", "prospeccion", {}],
    queryFn: () => api.get<ReporteProspeccion>("/api/v1/reportes/prospeccion"),
    enabled: puedeEditar
  });
  const numeros = new Map((prospeccion?.por_campana ?? []).map((c) => [c.campana_id, c as CampanaProspeccion]));

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
      setConfirmarFin(null);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["campanas"] });
      setOcupadoId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
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
        <span className="text-[12px] text-ink-3">Sin una campaña activa, la automatización no manda correos de prospección.</span>
      </div>

      <ServerError message={error} />
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudieron cargar las campañas.</div>}
      {data && data.data.length === 0 && estado && <div className="text-sm text-ink-3">No hay campañas con ese estado.</div>}

      {data && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {data.data.map((c) => (
            <TarjetaCampana
              key={c.id}
              campana={c}
              numeros={puedeEditar ? (numeros.get(c.id) ?? null) : undefined}
              puedeEditar={puedeEditar}
              ocupado={ocupadoId === c.id}
              onAccion={(accion) => (accion === "finalizar" ? setConfirmarFin(c) : void cambiarEstado(c, accion))}
              onEditar={() => setEditando(c)}
              onVerProspectos={() => onVerProspectos(c.id)}
            />
          ))}
          {puedeEditar && (
            <button
              type="button"
              onClick={() => setCreando(true)}
              className="grid min-h-[220px] place-items-center rounded-[18px] border-2 border-dashed border-border text-center font-bold text-ink-2 hover:border-info/60 hover:text-strong"
            >
              <span>
                <span className="block text-[30px] font-normal leading-none text-info">+</span>
                Nueva campaña
              </span>
            </button>
          )}
          {!puedeEditar && data.data.length === 0 && !estado && <div className="text-sm text-ink-3">Todavía no hay campañas.</div>}
        </div>
      )}
      {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}

      <Modal abierto={creando} onCerrar={() => setCreando(false)} titulo="Nueva campaña" descripcion="Solo canal correo. Nace en borrador: no manda nada hasta que la actives.">
        <CampanaForm onDone={() => setCreando(false)} />
      </Modal>
      <Modal abierto={editando !== null} onCerrar={() => setEditando(null)} titulo={editando ? `Editar «${editando.nombre}»` : "Editar campaña"}>
        {editando && <CampanaForm campana={editando} onDone={() => setEditando(null)} />}
      </Modal>
      <Modal
        abierto={confirmarFin !== null}
        onCerrar={() => setConfirmarFin(null)}
        titulo="¿Finalizar la campaña?"
        descripcion={confirmarFin ? `«${confirmarFin.nombre}» deja de mandar correos y sus recordatorios se cancelan. Es definitivo.` : undefined}
        acciones={
          <>
            <Button variant="ghost" onClick={() => setConfirmarFin(null)}>
              No, dejarla
            </Button>
            <Button variant="rechazar" disabled={confirmarFin !== null && ocupadoId === confirmarFin.id} onClick={() => confirmarFin && void cambiarEstado(confirmarFin, "finalizar")}>
              Sí, finalizar
            </Button>
          </>
        }
      />
    </div>
  );
}

const TONO_CAMPANA: Record<EstadoCampana, Tono> = { borrador: "neutro", activa: "ok", pausada: "warn", finalizada: "neutro" };

// Una campaña como tarjeta (docs/diseno/prospectos.html, pestaña Campañas):
// nombre, cuándo manda, estado, los tres números y la tasa de respuesta, y
// abajo "Ver prospectos" más las acciones que permite su estado.
function TarjetaCampana({
  campana: c,
  numeros,
  puedeEditar,
  ocupado,
  onAccion,
  onEditar,
  onVerProspectos
}: {
  campana: Campana;
  numeros: CampanaProspeccion | null | undefined;
  puedeEditar: boolean;
  ocupado: boolean;
  onAccion: (accion: Accion) => void;
  onEditar: () => void;
  onVerProspectos: () => void;
}) {
  const tasa = numeros?.tasa_respuesta_pct ?? null;
  const fechas = [c.fecha_inicio && `desde ${formatoFecha.format(fechaLocal(c.fecha_inicio))}`, c.fecha_fin && `hasta ${formatoFecha.format(fechaLocal(c.fecha_fin))}`].filter(Boolean).join(" · ");
  return (
    <section className="tarjeta-blanca flex flex-col overflow-hidden">
      <div className="flex items-start gap-2.5 border-b border-border px-[18px] py-4">
        <div className="min-w-0">
          <h4 className="font-heading text-[16px] font-extrabold text-strong">{c.nombre}</h4>
          <small className="mt-[3px] block text-[12px] text-ink-3">
            {c.activa_hoy ? "Manda hoy" : c.motivo ? ETIQUETA_MOTIVO_CAMPANA[c.motivo] : "No manda hoy"}
            {fechas && ` · ${fechas}`}
          </small>
        </div>
        <Pastilla tono={TONO_CAMPANA[c.estado]} className="ml-auto">
          {ETIQUETA_ESTADO_CAMPANA[c.estado]}
        </Pastilla>
      </div>
      {numeros !== undefined ? (
        <>
          <div className="grid grid-cols-3 gap-2 px-[18px] py-3.5">
            <Numero valor={numeros?.personas_contactadas ?? 0} etiqueta="Contactadas" />
            <Numero valor={numeros?.personas_que_respondieron ?? 0} etiqueta="Respondieron" />
            <Numero valor={numeros?.interesados ?? 0} etiqueta="Interesados" />
          </div>
          <div className="px-[18px] pb-4">
            <div className="mb-1.5 flex justify-between text-[12px] text-ink-2">
              <span>Tasa de respuesta</span>
              <b className="text-strong">{tasa == null ? "—" : `${tasa}%`}</b>
            </div>
            {/* La barra llena es 20 % de respuesta: con 5-15 % (lo normal en
                correo frío) se alcanza a ver la diferencia entre campañas. */}
            <i className="block h-2 overflow-hidden rounded-full bg-soft">
              <b className={`block h-full bg-[linear-gradient(90deg,var(--mint),var(--cyan))] ${c.estado === "activa" ? "" : "opacity-50"}`} style={{ width: `${Math.min(100, (tasa ?? 0) * 5)}%` }} />
            </i>
          </div>
        </>
      ) : (
        <div className="px-[18px] py-3.5">
          <Numero valor={c.prospectos} etiqueta="Prospectos" />
        </div>
      )}
      <div className="mt-auto border-t border-border bg-soft px-[18px] py-3">
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1 px-3 py-2 text-[12px]" onClick={onVerProspectos}>
            Ver prospectos
          </Button>
          {puedeEditar &&
            ACCIONES_CAMPANA[c.estado]
              .filter((accion) => accion !== "finalizar")
              .map((accion) => (
                <Button key={accion} variant="outline" className="flex-1 px-3 py-2 text-[12px]" disabled={ocupado} onClick={() => onAccion(accion)}>
                  {accion === "activar" && c.estado === "pausada" ? "Reanudar" : ETIQUETA_ACCION[accion]}
                </Button>
              ))}
        </div>
        {/* Lo que se usa poco va en chico: editar y finalizar (definitivo). */}
        {puedeEditar && c.estado !== "finalizada" && (
          <div className="mt-2 flex justify-end gap-3 text-[12px] font-bold">
            <button type="button" className="text-ink-2 hover:text-strong" onClick={onEditar}>
              Editar
            </button>
            {ACCIONES_CAMPANA[c.estado].includes("finalizar") && (
              <button type="button" className="text-danger hover:underline disabled:opacity-50" disabled={ocupado} onClick={() => onAccion("finalizar")}>
                Finalizar
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function Numero({ valor, etiqueta }: { valor: number; etiqueta: string }) {
  return (
    <div>
      <b className="mono block font-display text-[26px] font-normal leading-tight text-strong">{valor}</b>
      <span className="text-[11px] font-bold text-ink-3">{etiqueta}</span>
    </div>
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
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 pb-2">
      <div className="grid grid-cols-1 gap-4">
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
