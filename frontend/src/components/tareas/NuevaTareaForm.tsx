import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import type { NombreIcono } from "../ui/iconos";
import { Avatar } from "./DetalleTarea";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA } from "../../lib/tareas";
import { atajosNuevaTarea, textoVence, valorDatetimeLocal } from "../../lib/mi-dia";
import type { EmpresaDetalle, EmpresaListado, Paginated, Tarea, Usuario } from "../../types";

// "Nueva tarea" del rediseño (docs/diseno/tareas.html, panel al dar clic en
// "+ Nueva tarea"): tipo, prioridad, responsable y contacto con botones en
// vez de listas; fecha con atajos.
//
// Mismos límites que crearTareaSchema (src/tareas/dto/tarea.schema.ts). Sin
// "clasificacion": una tarea de ese tipo necesita un prospecto y solo se
// resuelve desde la cola, así que crearla a mano desde aquí quedaría huérfana.
const TIPOS = ["seguimiento", "revision_documento", "otro"] as const;
const PRIORIDADES = ["baja", "media", "alta", "urgente"] as const;
const tareaSchema = z.object({
  titulo: z.string().trim().min(2, "Escribe qué hay que hacer (mínimo 2 letras)").max(255, "Máximo 255 caracteres"),
  tipo: z.enum(TIPOS),
  prioridad: z.enum(PRIORIDADES),
  responsableId: z.string().min(1, "Elige a quién se asigna"),
  // Opcionales; vacío = sin empresa / sin contacto / sin fecha.
  empresaId: z.string(),
  contactoId: z.string(),
  fechaLimite: z.string(),
  descripcion: z.string().trim().max(4000, "Máximo 4000 caracteres")
});
type TareaInput = z.infer<typeof tareaSchema>;

const ICONO_TIPO: Record<(typeof TIPOS)[number], NombreIcono> = { seguimiento: "telefono", revision_documento: "documento", otro: "puntos" };
const PUNTO_PRIORIDAD: Record<Tarea["prioridad"], string> = { baja: "bg-ink-3", media: "bg-navy", alta: "bg-warn", urgente: "bg-danger" };
// Elegido: menta/cyan como el resto de los botones; alta y urgente con su color.
const ELEGIDO = "border-cyan bg-info-bg text-info";
const ELEGIDO_PRIORIDAD: Record<Tarea["prioridad"], string> = { baja: ELEGIDO, media: ELEGIDO, alta: "border-warn bg-warn-bg text-warn", urgente: "border-danger bg-danger-bg text-danger" };

// `usuarios` solo llega para admin/supervisor (GET /usuarios); un agente
// se asigna la tarea a sí mismo.
export function NuevaTareaForm({ usuarioActual, usuarios, onDone }: { usuarioActual: { id: number; nombre: string }; usuarios?: Usuario[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting }
  } = useForm<TareaInput>({
    resolver: zodResolver(tareaSchema),
    defaultValues: { titulo: "", tipo: "seguimiento", prioridad: "media", responsableId: String(usuarioActual.id), empresaId: "", contactoId: "", fechaLimite: "", descripcion: "" }
  });
  const [tipo, prioridad, responsableId, empresaId, contactoId, fechaLimite] = useWatch({ control, name: ["tipo", "prioridad", "responsableId", "empresaId", "contactoId", "fechaLimite"] });
  const validar = { shouldValidate: true } as const;

  const [ahora] = useState(() => new Date());
  const atajos = useMemo(() => atajosNuevaTarea(ahora), [ahora]);
  const personas = usuarios ?? [{ id: usuarioActual.id, nombre: usuarioActual.nombre }];
  const responsable = personas.find((u) => String(u.id) === responsableId);

  // Empresa elegida: se guarda la fila del buscador para pintar la tarjeta
  // sin otra llamada. El detalle (GET /empresas/:id) solo es para los contactos.
  const [empresa, setEmpresa] = useState<EmpresaListado | null>(null);
  const { data: detalle } = useQuery({
    queryKey: ["empresa", empresaId],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${empresaId}`),
    enabled: Boolean(empresaId)
  });
  // Una fila por medio en GET /empresas/:id: un contacto activo por id.
  const contactos = useMemo(() => [...new Map((detalle?.contactos ?? []).filter((c) => c.activo).map((c) => [c.id, c])).values()], [detalle]);

  function elegirEmpresa(e: EmpresaListado | null) {
    setEmpresa(e);
    setValue("empresaId", e ? String(e.id) : "");
    setValue("contactoId", "");
  }

  async function onSubmit(values: TareaInput) {
    setServerError(null);
    try {
      await api.post("/api/v1/tareas", {
        titulo: values.titulo,
        tipo: values.tipo,
        prioridad: values.prioridad,
        responsableId: Number(values.responsableId),
        empresaId: values.empresaId ? Number(values.empresaId) : undefined,
        contactoId: values.empresaId && values.contactoId ? Number(values.contactoId) : undefined,
        // datetime-local no trae zona horaria: se convierte con la del
        // navegador (igual que en NuevaActividadForm).
        fechaLimite: values.fechaLimite ? new Date(values.fechaLimite).toISOString() : undefined,
        descripcion: values.descripcion || undefined
      });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
      onDone();
    } catch (error) {
      // 409 PERSONA_EN_BAJA (seguimiento a alguien dado de baja), 404 si la
      // empresa no es del agente: el mensaje tal cual.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex min-h-full flex-col">
      <div className="flex flex-col gap-6 px-4 py-5 md:px-6">
        <Seccion icono="checkCirculo" titulo="Qué hay que hacer">
          <Campo etiqueta="Título" htmlFor="tarea-titulo" error={errors.titulo?.message}>
            <input id="tarea-titulo" autoFocus className={clsx(inputClass, "h-[42px] text-[14px]")} placeholder="Ej. Llamar para confirmar la visita a planta" {...register("titulo")} />
          </Campo>
          <Campo etiqueta="Tipo">
            <div role="group" aria-label="Tipo" className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
              {TIPOS.map((t) => (
                <Opcion key={t} elegida={tipo === t} onClick={() => setValue("tipo", t, validar)}>
                  <Icono nombre={ICONO_TIPO[t]} size={15} />
                  {ETIQUETA_TIPO_TAREA[t]}
                </Opcion>
              ))}
            </div>
          </Campo>
          <p className="flex gap-2 rounded-[12px] bg-navy-bg px-3.5 py-3 text-[12px] font-semibold leading-relaxed text-navy">
            <Icono nombre="info" size={15} className="mt-px shrink-0" />
            Las tareas para clasificar una respuesta no se crean aquí: las crea la automatización cuando alguien contesta un correo.
          </p>
        </Seccion>

        <Seccion icono="persona" titulo="Para quién y para cuándo">
          <Campo etiqueta="Responsable" error={errors.responsableId?.message}>
            <div role="group" aria-label="Responsable" className="flex flex-wrap gap-2">
              {personas.map((u) => (
                <Persona key={u.id} elegida={responsableId === String(u.id)} onClick={() => setValue("responsableId", String(u.id), validar)} disabled={!usuarios}>
                  <Avatar nombre={u.nombre} />
                  {u.nombre}
                  {u.id === usuarioActual.id && <span className="font-semibold text-ink-3">(tú)</span>}
                </Persona>
              ))}
            </div>
          </Campo>
          <Campo etiqueta="Prioridad">
            <div role="group" aria-label="Prioridad" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {PRIORIDADES.map((p) => (
                <Opcion key={p} elegida={prioridad === p} claseElegida={ELEGIDO_PRIORIDAD[p]} onClick={() => setValue("prioridad", p, validar)}>
                  <span className={clsx("h-2 w-2 rounded-full", PUNTO_PRIORIDAD[p])} />
                  {ETIQUETA_PRIORIDAD[p]}
                </Opcion>
              ))}
            </div>
          </Campo>
          <Campo etiqueta="Fecha límite" opcional htmlFor="tarea-fecha">
            <div role="group" aria-label="Atajos de fecha" className="flex flex-wrap gap-1.5">
              {atajos.map((a) => {
                const v = valorDatetimeLocal(a.fecha);
                // Volver a tocar el atajo elegido quita la fecha (es opcional).
                return (
                  <Opcion key={a.etiqueta} chica elegida={fechaLimite === v} onClick={() => setValue("fechaLimite", fechaLimite === v ? "" : v, validar)}>
                    {a.etiqueta}
                  </Opcion>
                );
              })}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <input id="tarea-fecha" type="datetime-local" className={clsx(inputClass, "h-[42px] text-[14px]")} min={valorDatetimeLocal(ahora)} {...register("fechaLimite")} />
              {fechaLimite && (
                <button type="button" onClick={() => setValue("fechaLimite", "", validar)} className="shrink-0 text-[12px] font-bold text-ink-3 hover:text-strong">
                  Quitar
                </button>
              )}
            </div>
          </Campo>
        </Seccion>

        <Seccion icono="empresa" titulo="Con quién" opcional>
          <Campo etiqueta="Empresa" htmlFor="tarea-empresa">
            {empresa ? (
              <div className="flex items-center gap-3 rounded-[12px] border border-cyan bg-info-bg px-3 py-2.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-navy font-heading text-[12px] font-extrabold text-white">{inicialesEmpresa(nombreEmpresa(empresa))}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-bold text-strong">{nombreEmpresa(empresa)}</div>
                  <div className="truncate text-[12px] text-ink-2">{[empresa.giro, empresa.estado, empresa.propietario_nombre && `responsable: ${empresa.propietario_nombre}`].filter(Boolean).join(" · ")}</div>
                </div>
                <button type="button" onClick={() => elegirEmpresa(null)} className="shrink-0 text-[12px] font-extrabold text-info hover:underline">
                  Cambiar
                </button>
              </div>
            ) : (
              <BuscadorEmpresa onElegir={elegirEmpresa} />
            )}
          </Campo>
          {empresa && (
            <Campo etiqueta="Contacto" opcional>
              {contactos.length === 0 ? (
                <p className="text-[13px] text-ink-3">{detalle ? "Esta empresa no tiene contactos activos." : "Cargando contactos…"}</p>
              ) : (
                <div role="group" aria-label="Contacto" className="flex flex-wrap gap-2">
                  {contactos.map((c) => (
                    // Volver a tocarlo lo quita: el contacto es opcional.
                    <Persona key={c.id} elegida={contactoId === String(c.id)} onClick={() => setValue("contactoId", contactoId === String(c.id) ? "" : String(c.id), validar)}>
                      <Avatar nombre={c.nombre} />
                      {c.nombre}
                      {c.puesto && <span className="font-semibold text-ink-3">· {c.puesto}</span>}
                    </Persona>
                  ))}
                </div>
              )}
            </Campo>
          )}
        </Seccion>

        <Seccion icono="menu" titulo="Detalles" opcional>
          <Campo etiqueta="Descripción" htmlFor="tarea-descripcion" error={errors.descripcion?.message}>
            <textarea id="tarea-descripcion" rows={3} className={clsx(inputClass, "resize-y text-[14px] leading-relaxed")} placeholder="Lo que necesita saber quien la va a hacer." {...register("descripcion")} />
          </Campo>
        </Seccion>
        <ServerError message={serverError} />
      </div>

      <div className="sticky bottom-0 mt-auto flex items-center gap-2.5 border-t border-border bg-card px-4 py-4 md:px-6">
        <p className="mr-auto hidden min-w-0 text-[12px] leading-snug text-ink-2 sm:block">
          Se asigna a <b className="text-strong">{responsable?.id === usuarioActual.id ? "ti" : (responsable?.nombre ?? "—")}</b> · <span className="lowercase">{textoVence(fechaLimite ? new Date(fechaLimite).toISOString() : null, ahora)}</span>
        </p>
        <Button type="button" variant="outline" onClick={onDone} className="flex-1 sm:flex-none">
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none">
          Crear tarea
        </Button>
      </div>
    </form>
  );
}

// GET /empresas?q= busca en el servidor (a un agente solo le salen las
// suyas, las únicas donde puede crear tareas: en otra la API responde 404).
function BuscadorEmpresa({ onElegir }: { onElegir: (e: EmpresaListado) => void }) {
  const [texto, setTexto] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 250);
    return () => clearTimeout(t);
  }, [texto]);
  const { data, isFetching } = useQuery({
    queryKey: ["empresas", "buscador", q],
    queryFn: () => api.get<Paginated<EmpresaListado>>("/api/v1/empresas", { q, limit: 6 }),
    enabled: q.length > 0
  });
  const resultados = q ? (data?.data ?? []) : [];
  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <Icono nombre="buscar" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
        <input id="tarea-empresa" type="search" autoComplete="off" className={clsx(inputClass, "h-[42px] pl-9 text-[14px]")} placeholder="Buscar empresa por nombre…" value={texto} onChange={(e) => setTexto(e.target.value)} />
      </div>
      {q && (
        <div className="overflow-hidden rounded-[12px] border border-border bg-card">
          {resultados.length === 0 ? (
            <p className="px-3.5 py-3 text-[13px] text-ink-3">{isFetching ? "Buscando…" : "No hay empresas con ese nombre."}</p>
          ) : (
            resultados.map((e) => (
              <button key={e.id} type="button" onClick={() => onElegir(e)} className="flex w-full items-center gap-3 border-b border-border px-3.5 py-2.5 text-left last:border-b-0 hover:bg-soft">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[9px] bg-navy-bg font-heading text-[11px] font-extrabold text-navy">{inicialesEmpresa(nombreEmpresa(e))}</span>
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-bold text-strong">{nombreEmpresa(e)}</span>
                  <span className="block truncate text-[12px] text-ink-3">{[e.giro, e.estado].filter(Boolean).join(" · ") || "Sin giro"}</span>
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function Seccion({ icono, titulo, opcional, children }: { icono: NombreIcono; titulo: string; opcional?: boolean; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3.5">
      <h3 className="flex items-center gap-2.5 font-heading text-[13px] font-extrabold text-strong">
        <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-navy-bg text-navy">
          <Icono nombre={icono} size={15} />
        </span>
        {titulo}
        {opcional && <span className="font-sans text-[12px] font-semibold text-ink-3">opcional</span>}
      </h3>
      {children}
    </section>
  );
}

function Campo({ etiqueta, htmlFor, opcional, error, children }: { etiqueta: string; htmlFor?: string; opcional?: boolean; error?: string; children: ReactNode }) {
  const texto = (
    <>
      {etiqueta}
      {opcional && <span className="font-medium text-ink-3"> (opcional)</span>}
    </>
  );
  return (
    <div className="flex flex-col gap-1.5">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-[12px] font-bold text-ink-2">
          {texto}
        </label>
      ) : (
        <span className="text-[12px] font-bold text-ink-2">{texto}</span>
      )}
      {children}
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </div>
  );
}

function Opcion({ elegida, claseElegida = ELEGIDO, chica, onClick, children }: { elegida: boolean; claseElegida?: string; chica?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap border font-bold",
        chica ? "h-[34px] rounded-full px-3.5 text-[12px]" : "h-[42px] rounded-[11px] px-2.5 text-[13px]",
        elegida ? claseElegida : "border-border bg-card text-ink-2 hover:border-cyan/50 hover:text-strong"
      )}
    >
      {children}
    </button>
  );
}

function Persona({ elegida, disabled, onClick, children }: { elegida: boolean; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={elegida}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-[13px] font-bold",
        elegida ? ELEGIDO : "border-border bg-card text-ink-2 hover:border-cyan/50 hover:text-strong",
        disabled && "cursor-default"
      )}
    >
      {children}
    </button>
  );
}

function nombreEmpresa(e: { nombre_legal: string; nombre_comercial: string | null }) {
  return e.nombre_comercial || e.nombre_legal;
}

function inicialesEmpresa(nombre: string) {
  const partes = nombre.replace(/\b(S\.?A\.?|de|C\.?V\.?|S\.? de R\.?L\.?)\b/gi, " ").trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase() || "?";
}
