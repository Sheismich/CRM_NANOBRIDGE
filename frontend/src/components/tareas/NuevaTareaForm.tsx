import { useMemo, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA } from "../../lib/tareas";
import type { Empresa, EmpresaDetalle, Paginated, Usuario } from "../../types";

// Mismos límites que crearTareaSchema (src/tareas/dto/tarea.schema.ts). Sin
// "clasificacion": una tarea de ese tipo necesita un prospecto y solo se
// resuelve desde la cola, así que crearla a mano desde aquí quedaría huérfana.
const TIPOS = ["seguimiento", "revision_documento", "otro"] as const;
const tareaSchema = z.object({
  titulo: z.string().trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
  tipo: z.enum(TIPOS),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]),
  responsableId: z.string().min(1, "Elige a quién se asigna"),
  // Opcionales; vacío = sin empresa / sin contacto.
  empresaId: z.string(),
  contactoId: z.string(),
  fechaLimite: z.string(),
  descripcion: z.string().trim().max(4000, "Máximo 4000 caracteres")
});
type TareaInput = z.infer<typeof tareaSchema>;

// `usuarios` solo llega para admin/supervisor (GET /usuarios); un agente
// se asigna la tarea a sí mismo.
export function NuevaTareaForm({ usuarioActualId, usuarios, onDone }: { usuarioActualId: number; usuarios?: Usuario[]; onDone: () => void }) {
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
    defaultValues: { titulo: "", tipo: "seguimiento", prioridad: "media", responsableId: String(usuarioActualId), empresaId: "", contactoId: "", fechaLimite: "", descripcion: "" }
  });

  // GET /empresas no tiene búsqueda: se traen las primeras 100 (por nombre)
  // y se filtran aquí. A un agente le llegan solo las suyas, que son las
  // únicas en las que puede crear tareas (C2: en otra responde 404).
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const { data: empresas } = useQuery({
    queryKey: ["empresas", "selector"],
    queryFn: () => api.get<Paginated<Empresa>>("/api/v1/empresas", { limit: 100 })
  });
  const empresaId = useWatch({ control, name: "empresaId" });
  const opcionesEmpresa = useMemo(() => {
    const q = filtroEmpresa.trim().toLowerCase();
    const todas = empresas?.data ?? [];
    return q ? todas.filter((e) => e.id === Number(empresaId) || `${e.nombre_legal} ${e.nombre_comercial ?? ""}`.toLowerCase().includes(q)) : todas;
  }, [empresas, filtroEmpresa, empresaId]);
  const { data: empresa } = useQuery({
    queryKey: ["empresa", empresaId],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${empresaId}`),
    enabled: Boolean(empresaId)
  });
  // Una fila por medio en GET /empresas/:id: un contacto activo por id.
  const contactos = useMemo(() => [...new Map((empresa?.contactos ?? []).filter((c) => c.activo).map((c) => [c.id, c.nombre])).entries()], [empresa]);

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
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="md:col-span-2">
          <Field label="Título" htmlFor="tarea-titulo" error={errors.titulo?.message}>
            <input id="tarea-titulo" className={inputClass} placeholder="Ej. Llamar para confirmar visita" {...register("titulo")} />
          </Field>
        </div>
        <Field label="Tipo" htmlFor="tarea-tipo">
          <select id="tarea-tipo" className={inputClass} {...register("tipo")}>
            {TIPOS.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO_TAREA[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Prioridad" htmlFor="tarea-prioridad">
          <select id="tarea-prioridad" className={inputClass} {...register("prioridad")}>
            {(["urgente", "alta", "media", "baja"] as const).map((p) => (
              <option key={p} value={p}>
                {ETIQUETA_PRIORIDAD[p]}
              </option>
            ))}
          </select>
        </Field>
        {usuarios && (
          <Field label="Responsable" htmlFor="tarea-responsable" error={errors.responsableId?.message}>
            <select id="tarea-responsable" className={inputClass} {...register("responsableId")}>
              {usuarios.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.nombre}
                  {u.id === usuarioActualId ? " (yo)" : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="md:col-span-2">
          <Field label="Empresa (opcional)" htmlFor="tarea-empresa">
            <div className="flex gap-2">
              <input aria-label="Filtrar empresas" placeholder="Filtrar…" className={`${inputClass} max-w-40`} value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} />
              <select id="tarea-empresa" className={inputClass} {...register("empresaId", { onChange: () => setValue("contactoId", "") })}>
                <option value="">— Sin empresa —</option>
                {opcionesEmpresa.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre_legal}
                  </option>
                ))}
              </select>
            </div>
          </Field>
        </div>
        {empresaId && (
          <Field label="Contacto (opcional)" htmlFor="tarea-contacto">
            <select id="tarea-contacto" className={inputClass} {...register("contactoId")}>
              <option value="">— Ninguno —</option>
              {contactos.map(([id, nombre]) => (
                <option key={id} value={id}>
                  {nombre}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Fecha límite (opcional)" htmlFor="tarea-fecha">
          <input id="tarea-fecha" type="datetime-local" className={inputClass} {...register("fechaLimite")} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Descripción (opcional)" htmlFor="tarea-descripcion" error={errors.descripcion?.message}>
            <input id="tarea-descripcion" className={inputClass} {...register("descripcion")} />
          </Field>
        </div>
      </div>
      <ServerError message={serverError} />
      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          Crear tarea
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
