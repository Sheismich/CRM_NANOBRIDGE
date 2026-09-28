import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";

// Mismos límites que crearActividadSchema (src/crm/dto/actividad.schema.ts).
// Los opcionales se manejan como string vacío en el formulario y se quitan
// al armar el payload.
const actividadSchema = z
  .object({
    tipo: z.enum(["llamada", "whatsapp", "comentario"]),
    contactoId: z.string(),
    resultado: z.string().trim().max(255, "Máximo 255 caracteres"),
    proximaAccion: z.string().trim().max(255, "Máximo 255 caracteres"),
    comentario: z.string().trim().max(4000, "Máximo 4000 caracteres"),
    ocurridaEn: z.string()
  })
  // El backend acepta todo vacío; aquí se exige lo mínimo para que el
  // registro diga algo en el Historial.
  .refine((v) => v.tipo !== "comentario" || v.comentario.length > 0, { message: "Escribe el comentario", path: ["comentario"] })
  .refine((v) => v.tipo === "comentario" || v.resultado.length > 0 || v.comentario.length > 0, {
    message: "Anota el resultado o un comentario",
    path: ["resultado"]
  });
type ActividadInput = z.infer<typeof actividadSchema>;

export function NuevaActividadForm({ empresaId, contactos, onDone }: { empresaId: number; contactos: { id: number; nombre: string }[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting }
  } = useForm<ActividadInput>({
    resolver: zodResolver(actividadSchema),
    defaultValues: { tipo: "llamada", contactoId: "", resultado: "", proximaAccion: "", comentario: "", ocurridaEn: "" }
  });
  const tipo = useWatch({ control, name: "tipo" });

  async function onSubmit(values: ActividadInput) {
    setServerError(null);
    try {
      await api.post("/api/v1/actividades", {
        empresaId,
        tipo: values.tipo,
        contactoId: values.contactoId ? Number(values.contactoId) : undefined,
        // Ocultos para "comentario": no mandar lo que quedó escrito antes de
        // cambiar el tipo.
        resultado: (values.tipo !== "comentario" && values.resultado) || undefined,
        proximaAccion: (values.tipo !== "comentario" && values.proximaAccion) || undefined,
        comentario: values.comentario || undefined,
        // datetime-local no trae zona horaria: se convierte aquí con la del
        // navegador; mandado crudo, el servidor (UTC) lo leería corrido.
        ocurridaEn: values.ocurridaEn ? new Date(values.ocurridaEn).toISOString() : undefined
      });
      await queryClient.invalidateQueries({ queryKey: ["timeline", empresaId] });
      onDone();
    } catch (error) {
      // 404 "Empresa no encontrada": un agente solo registra en sus empresas.
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="mb-6 flex flex-col gap-4 rounded-[10px] border border-border bg-bg p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Tipo" htmlFor="act-tipo">
          <select id="act-tipo" className={inputClass} {...register("tipo")}>
            <option value="llamada">Llamada</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="comentario">Comentario</option>
          </select>
        </Field>
        <Field label="Contacto (opcional)" htmlFor="act-contacto">
          <select id="act-contacto" className={inputClass} {...register("contactoId")}>
            <option value="">— Ninguno —</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Fecha y hora (vacío = ahora)" htmlFor="act-fecha">
          <input id="act-fecha" type="datetime-local" className={inputClass} {...register("ocurridaEn")} />
        </Field>
      </div>

      {tipo !== "comentario" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field label="Resultado" htmlFor="act-resultado" error={errors.resultado?.message}>
            <input id="act-resultado" placeholder="Ej. Pidió la ficha técnica" className={inputClass} {...register("resultado")} />
          </Field>
          <Field label="Próxima acción" htmlFor="act-proxima" error={errors.proximaAccion?.message}>
            <input id="act-proxima" placeholder="Ej. Enviar ficha el lunes" className={inputClass} {...register("proximaAccion")} />
          </Field>
        </div>
      )}

      <Field label="Comentario" htmlFor="act-comentario" error={errors.comentario?.message}>
        <textarea id="act-comentario" rows={3} className={inputClass} {...register("comentario")} />
      </Field>

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
