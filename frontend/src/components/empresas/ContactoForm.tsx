import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import type { ContactoConMedio } from "../../types";
import { correoOpcional, sinVacios, soloCambios, telefonoOpcional, textoOpcional, urlOpcional } from "./campos";

// Mismos límites que contactInputSchema / updateContactSchema del backend.
const baseSchema = z.object({
  nombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
  puesto: textoOpcional(160),
  area: textoOpcional(160),
  correo: correoOpcional,
  telefono: telefonoOpcional,
  whatsapp: telefonoOpcional,
  linkedinUrl: urlOpcional,
  facebookUrl: urlOpcional,
  instagramUrl: urlOpcional
});
// En el alta se exige un medio aquí mismo; en la edición lo revisa el
// backend (409 "debe conservar al menos un medio"), porque un medio
// suprimido no aparece como campo editable pero sí cuenta.
const altaSchema = baseSchema.refine((c) => c.correo || c.telefono || c.whatsapp, {
  message: "Captura al menos un correo, teléfono o WhatsApp",
  path: ["correo"]
});
type ContactoInput = z.infer<typeof baseSchema>;

const MEDIOS = [
  { campo: "correo", etiqueta: "Correo", inputMode: "email" },
  { campo: "telefono", etiqueta: "Teléfono", inputMode: "tel" },
  { campo: "whatsapp", etiqueta: "WhatsApp", inputMode: "tel" }
] as const;

export type ContactoAgrupado = { contacto: ContactoConMedio; medios: ContactoConMedio[] };

// Sin `contacto`: alta (POST /empresas/:id/contactos). Con `contacto`:
// edición (PATCH /empresas/:id/contactos/:contactoId), mandando solo lo que
// cambió. Un medio en no_contactar (pidió que no le escriban) se muestra
// pero no se edita: vaciarlo lo marcaría obsoleto y perdería la supresión.
export function ContactoForm({ empresaId, contacto, onDone }: { empresaId: number; contacto?: ContactoAgrupado; onDone: () => void }) {
  const esAlta = !contacto;
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);

  const medioVigente = (tipo: string) => contacto?.medios.find((m) => m.medio_tipo === tipo && m.estado_contacto !== "obsoleto");
  const suprimido = (tipo: string) => medioVigente(tipo)?.estado_contacto === "no_contactar";
  const valorMedio = (tipo: string) => (suprimido(tipo) ? "" : (medioVigente(tipo)?.medio_valor ?? ""));

  const c = contacto?.contacto;
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields }
  } = useForm<ContactoInput>({
    resolver: zodResolver(esAlta ? altaSchema : baseSchema),
    defaultValues: {
      nombre: c?.nombre ?? "",
      puesto: c?.puesto ?? "",
      area: c?.area ?? "",
      correo: valorMedio("correo"),
      telefono: valorMedio("telefono"),
      whatsapp: valorMedio("whatsapp"),
      linkedinUrl: c?.linkedin_url ?? "",
      facebookUrl: c?.facebook_url ?? "",
      instagramUrl: c?.instagram_url ?? ""
    }
  });

  async function onSubmit(values: ContactoInput) {
    setServerError(null);
    try {
      if (esAlta) {
        await api.post(`/api/v1/empresas/${empresaId}/contactos`, sinVacios(values));
      } else {
        const cambios = soloCambios(values, dirtyFields);
        if (Object.keys(cambios).length > 0) await api.patch(`/api/v1/empresas/${empresaId}/contactos/${contacto.contacto.id}`, cambios);
      }
      await queryClient.invalidateQueries({ queryKey: ["empresa", String(empresaId)] });
      await queryClient.invalidateQueries({ queryKey: ["contactos"] });
      onDone();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 rounded-[10px] border border-border bg-bg p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Nombre" htmlFor="ct-nombre" error={errors.nombre?.message}>
          <input id="ct-nombre" className={inputClass} {...register("nombre")} />
        </Field>
        <Field label="Puesto (opcional)" htmlFor="ct-puesto" error={errors.puesto?.message}>
          <input id="ct-puesto" className={inputClass} {...register("puesto")} />
        </Field>
        <Field label="Área (opcional)" htmlFor="ct-area" error={errors.area?.message}>
          <input id="ct-area" className={inputClass} {...register("area")} />
        </Field>
        {MEDIOS.map((m) =>
          suprimido(m.campo) ? (
            <Field key={m.campo} label={m.etiqueta} htmlFor={`ct-${m.campo}`}>
              <div id={`ct-${m.campo}`} className="rounded-[9px] bg-danger-bg px-3 py-2 text-[13px] text-danger" title="Pidió que no se le contacte por este medio">
                {medioVigente(m.campo)?.medio_valor} · no contactar
              </div>
            </Field>
          ) : (
            <Field key={m.campo} label={m.etiqueta} htmlFor={`ct-${m.campo}`} error={errors[m.campo]?.message}>
              <input id={`ct-${m.campo}`} inputMode={m.inputMode} className={inputClass} {...register(m.campo)} />
            </Field>
          )
        )}
        <Field label="LinkedIn (opcional)" htmlFor="ct-linkedin" error={errors.linkedinUrl?.message}>
          <input id="ct-linkedin" placeholder="https://" className={inputClass} {...register("linkedinUrl")} />
        </Field>
        <Field label="Facebook (opcional)" htmlFor="ct-facebook" error={errors.facebookUrl?.message}>
          <input id="ct-facebook" placeholder="https://" className={inputClass} {...register("facebookUrl")} />
        </Field>
        <Field label="Instagram (opcional)" htmlFor="ct-instagram" error={errors.instagramUrl?.message}>
          <input id="ct-instagram" placeholder="https://" className={inputClass} {...register("instagramUrl")} />
        </Field>
      </div>
      {!esAlta && <div className="text-xs text-ink-3">Vaciar un correo o teléfono lo marca como obsoleto; queda en el historial de auditoría.</div>}

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : esAlta ? "Agregar contacto" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
