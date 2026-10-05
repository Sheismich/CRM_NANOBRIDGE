import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";

// Mismos límites que crearOportunidadSchema (src/comercial/dto/oportunidad.schema.ts).
// Sin responsable: el backend la asigna a quien la crea (y a un agente
// siempre a sí mismo). Nace en la etapa "calificada".
const VALOR_MAXIMO = 9_999_999_999.99;
const oportunidadSchema = z.object({
  titulo: z.string().trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
  contactoId: z.string(),
  // Tope de DECIMAL(12,2), el mismo que el backend (arriba responde 400).
  valorEstimado: z
    .string()
    .trim()
    .refine((v) => v === "" || (Number.isFinite(Number(v)) && Number(v) >= 0), "Monto inválido")
    .refine((v) => v === "" || Number(v) <= VALOR_MAXIMO, "Máximo $9,999,999,999.99"),
  fechaCierreEstimada: z.string()
});
type OportunidadInput = z.infer<typeof oportunidadSchema>;

export function NuevaOportunidadForm({ empresaId, contactos, onDone }: { empresaId: number; contactos: { id: number; nombre: string }[]; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<OportunidadInput>({
    resolver: zodResolver(oportunidadSchema),
    defaultValues: { titulo: "", contactoId: "", valorEstimado: "", fechaCierreEstimada: "" }
  });

  async function onSubmit(values: OportunidadInput) {
    setServerError(null);
    try {
      await api.post("/api/v1/oportunidades", {
        empresaId,
        titulo: values.titulo,
        contactoId: values.contactoId ? Number(values.contactoId) : undefined,
        valorEstimado: values.valorEstimado ? Number(values.valorEstimado) : undefined,
        fechaCierreEstimada: values.fechaCierreEstimada || undefined
      });
      await queryClient.invalidateQueries({ queryKey: ["oportunidades"] });
      onDone();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Título" htmlFor="op-titulo" error={errors.titulo?.message}>
          <input id="op-titulo" placeholder="Ej. Recubrimiento anticorrosivo planta Norte" className={inputClass} {...register("titulo")} />
        </Field>
        <Field label="Contacto principal (opcional)" htmlFor="op-contacto">
          <select id="op-contacto" className={inputClass} {...register("contactoId")}>
            <option value="">— Ninguno —</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Valor estimado (MXN, opcional)" htmlFor="op-valor" error={errors.valorEstimado?.message}>
          <input id="op-valor" inputMode="decimal" placeholder="0.00" className={inputClass} {...register("valorEstimado")} />
        </Field>
        <Field label="Cierre estimado (opcional)" htmlFor="op-cierre">
          <input id="op-cierre" type="date" className={inputClass} {...register("fechaCierreEstimada")} />
        </Field>
      </div>

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creando…" : "Crear oportunidad"}
        </Button>
      </div>
    </form>
  );
}
