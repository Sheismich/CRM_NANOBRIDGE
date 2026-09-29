import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA } from "../../lib/tareas";
import type { Usuario } from "../../types";

// Mismos límites que crearTareaSchema (src/tareas/dto/tarea.schema.ts). Sin
// "clasificacion": una tarea de ese tipo necesita un prospecto y solo se
// resuelve desde la cola, así que crearla a mano desde aquí quedaría huérfana.
const TIPOS = ["seguimiento", "revision_documento", "otro"] as const;
const tareaSchema = z.object({
  titulo: z.string().trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
  tipo: z.enum(TIPOS),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]),
  responsableId: z.string().min(1, "Elige a quién se asigna"),
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
    formState: { errors, isSubmitting }
  } = useForm<TareaInput>({
    resolver: zodResolver(tareaSchema),
    defaultValues: { titulo: "", tipo: "seguimiento", prioridad: "media", responsableId: String(usuarioActualId), fechaLimite: "", descripcion: "" }
  });

  async function onSubmit(values: TareaInput) {
    setServerError(null);
    try {
      await api.post("/api/v1/tareas", {
        titulo: values.titulo,
        tipo: values.tipo,
        prioridad: values.prioridad,
        responsableId: Number(values.responsableId),
        // datetime-local no trae zona horaria: se convierte con la del
        // navegador (igual que en NuevaActividadForm).
        fechaLimite: values.fechaLimite ? new Date(values.fechaLimite).toISOString() : undefined,
        descripcion: values.descripcion || undefined
      });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
      onDone();
    } catch (error) {
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
