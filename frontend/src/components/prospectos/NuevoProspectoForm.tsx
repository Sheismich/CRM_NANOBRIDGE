import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import type { Borrador } from "../../types";
import { TAMANOS, correoOpcional, sinVacios, telefonoOpcional, textoOpcional, urlOpcional } from "../empresas/campos";

// Mismos límites que prospectoInputSchema (src/crm/dto/prospecto.schema.ts).
// El backend deduplica por correo y teléfono, por eso pide al menos uno, y
// el canal inicial debe tener su medio (WhatsApp usa el teléfono).
const prospectoSchema = z
  .object({
    empresaNombreLegal: z.string().trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
    empresaGiro: textoOpcional(120),
    empresaTamano: z.string(),
    empresaRegion: textoOpcional(120),
    empresaEstado: textoOpcional(120),
    empresaCiudad: textoOpcional(120),
    empresaSitioWeb: urlOpcional,
    contactoNombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
    contactoPuesto: textoOpcional(160),
    correo: correoOpcional,
    telefono: telefonoOpcional,
    canalInicial: z.enum(["correo", "telefono", "whatsapp"]),
    prioridad: z.string(),
    confianza: z.string(),
    fuenteUrl: urlOpcional,
    observaciones: textoOpcional(2000)
  })
  .refine((p) => p.correo || p.telefono, { message: "Captura correo o teléfono", path: ["correo"] })
  .refine((p) => (p.canalInicial === "correo" ? p.correo : p.telefono), { message: "El canal inicial necesita su medio (WhatsApp usa el teléfono)", path: ["canalInicial"] });
type ProspectoInput = z.infer<typeof prospectoSchema>;

type Confirmado = { id: number; empresa_id?: number };

// POST /prospectos crea un borrador de una fila (lote "manual") que pasa
// por la misma deduplicación que el CSV; aquí se confirma en el mismo paso,
// porque quien lo captura ya lo revisó. Si sale duplicado contra un
// contacto existente, se pregunta antes de reutilizarlo.
export function NuevoProspectoForm({ onDone }: { onDone: (prospectoId: number | null) => void }) {
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<Borrador | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting }
  } = useForm<ProspectoInput>({
    resolver: zodResolver(prospectoSchema),
    defaultValues: {
      empresaNombreLegal: "",
      empresaGiro: "",
      empresaTamano: "",
      empresaRegion: "",
      empresaEstado: "",
      empresaCiudad: "",
      empresaSitioWeb: "",
      contactoNombre: "",
      contactoPuesto: "",
      correo: "",
      telefono: "",
      canalInicial: "correo",
      prioridad: "",
      confianza: "",
      fuenteUrl: "",
      observaciones: ""
    }
  });

  async function confirmar(borrador: Borrador, usarContactoExistente: boolean) {
    const res = await api.post<Confirmado>(`/api/v1/prospectos/importaciones/${borrador.lote_id}/filas/${borrador.id}/confirmar`, { usarContactoExistente });
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["prospectos"] }), queryClient.invalidateQueries({ queryKey: ["empresas"] })]);
    onDone(res.id);
  }

  async function onSubmit(values: ProspectoInput) {
    setServerError(null);
    try {
      const borrador = await api.post<Borrador>("/api/v1/prospectos", sinVacios(values));
      if (borrador.estado === "duplicado") {
        setDuplicado(borrador);
        return;
      }
      await confirmar(borrador, false);
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  async function resolverDuplicado(usar: boolean) {
    if (!duplicado) return;
    setServerError(null);
    setOcupado(true);
    try {
      if (usar) {
        await confirmar(duplicado, true);
      } else {
        // Descartar: el borrador queda rechazado, no se crea nada.
        await api.post(`/api/v1/prospectos/importaciones/${duplicado.lote_id}/filas/${duplicado.id}/rechazar`);
        onDone(null);
      }
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  if (duplicado) {
    const medio = duplicado.match_motivo === "telefono" ? "teléfono" : "correo";
    return (
      <div className="flex flex-col gap-3 border-b border-border bg-warn-bg p-5">
        <div className="text-[13px] font-bold text-warn">Posible duplicado</div>
        <div className="text-[13px] text-ink">
          {duplicado.match_contacto_id
            ? `Ya existe un contacto con el mismo ${medio}. Puedes registrar el prospecto sobre ese contacto o descartar la captura.`
            : (duplicado.errores?.map((e) => e.mensaje).join("; ") ?? "El prospecto coincide con otro registro.")}
        </div>
        <ServerError message={serverError} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" disabled={ocupado} onClick={() => void resolverDuplicado(false)}>
            Descartar
          </Button>
          {duplicado.match_contacto_id && (
            <Button variant="outline" disabled={ocupado} onClick={() => void resolverDuplicado(true)}>
              Usar contacto existente
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
      <div className="text-xs font-bold uppercase tracking-wide text-ink-2">Empresa</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Nombre legal" htmlFor="pr-empresa" error={errors.empresaNombreLegal?.message}>
          <input id="pr-empresa" className={inputClass} {...register("empresaNombreLegal")} />
        </Field>
        <Field label="Giro (opcional)" htmlFor="pr-giro" error={errors.empresaGiro?.message}>
          <input id="pr-giro" className={inputClass} {...register("empresaGiro")} />
        </Field>
        <Field label="Tamaño (opcional)" htmlFor="pr-tamano">
          <select id="pr-tamano" className={inputClass} {...register("empresaTamano")}>
            <option value="">— Sin dato —</option>
            {TAMANOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Región (opcional)" htmlFor="pr-region" error={errors.empresaRegion?.message}>
          <input id="pr-region" className={inputClass} {...register("empresaRegion")} />
        </Field>
        <Field label="Estado (opcional)" htmlFor="pr-estado" error={errors.empresaEstado?.message}>
          <input id="pr-estado" className={inputClass} {...register("empresaEstado")} />
        </Field>
        <Field label="Ciudad (opcional)" htmlFor="pr-ciudad" error={errors.empresaCiudad?.message}>
          <input id="pr-ciudad" className={inputClass} {...register("empresaCiudad")} />
        </Field>
        <Field label="Sitio web (opcional)" htmlFor="pr-web" error={errors.empresaSitioWeb?.message}>
          <input id="pr-web" placeholder="https://" className={inputClass} {...register("empresaSitioWeb")} />
        </Field>
      </div>

      <div className="text-xs font-bold uppercase tracking-wide text-ink-2">Contacto</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Nombre" htmlFor="pr-contacto" error={errors.contactoNombre?.message}>
          <input id="pr-contacto" className={inputClass} {...register("contactoNombre")} />
        </Field>
        <Field label="Puesto (opcional)" htmlFor="pr-puesto" error={errors.contactoPuesto?.message}>
          <input id="pr-puesto" className={inputClass} {...register("contactoPuesto")} />
        </Field>
        <Field label="Canal inicial" htmlFor="pr-canal" error={errors.canalInicial?.message}>
          <select id="pr-canal" className={inputClass} {...register("canalInicial")}>
            <option value="correo">Correo</option>
            <option value="telefono">Teléfono</option>
            <option value="whatsapp">WhatsApp</option>
          </select>
        </Field>
        <Field label="Correo" htmlFor="pr-correo" error={errors.correo?.message}>
          <input id="pr-correo" type="email" className={inputClass} {...register("correo")} />
        </Field>
        <Field label="Teléfono / WhatsApp" htmlFor="pr-telefono" error={errors.telefono?.message}>
          <input id="pr-telefono" inputMode="tel" className={inputClass} {...register("telefono")} />
        </Field>
      </div>

      <div className="text-xs font-bold uppercase tracking-wide text-ink-2">Calificación</div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Prioridad (opcional)" htmlFor="pr-prioridad">
          <select id="pr-prioridad" className={inputClass} {...register("prioridad")}>
            <option value="">— Sin dato —</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </Field>
        <Field label="Confianza del dato (opcional)" htmlFor="pr-confianza">
          <select id="pr-confianza" className={inputClass} {...register("confianza")}>
            <option value="">— Sin dato —</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="baja">Baja</option>
          </select>
        </Field>
        <Field label="Fuente (URL, opcional)" htmlFor="pr-fuente" error={errors.fuenteUrl?.message}>
          <input id="pr-fuente" placeholder="https://" className={inputClass} {...register("fuenteUrl")} />
        </Field>
      </div>
      <Field label="Observaciones (opcional)" htmlFor="pr-obs" error={errors.observaciones?.message}>
        <textarea id="pr-obs" rows={2} className={inputClass} {...register("observaciones")} />
      </Field>

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onDone(null)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : "Crear prospecto"}
        </Button>
      </div>
    </form>
  );
}
