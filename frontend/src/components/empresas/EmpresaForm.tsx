import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import type { EmpresaDetalle } from "../../types";
import { TAMANOS, correoOpcional, sinVacios, soloCambios, telefonoOpcional, textoOpcional, urlOpcional } from "./campos";

// Mismos límites que companyInputSchema / updateCompanySchema del backend
// (src/crm/dto/empresa.schema.ts).
const empresaSchema = z.object({
  nombreLegal: z.string().trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
  nombreComercial: textoOpcional(255),
  giro: textoOpcional(120),
  tamano: z.string(),
  region: textoOpcional(120),
  estado: textoOpcional(120),
  ciudad: textoOpcional(120),
  pais: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, "Código de 2 letras (ej. MX)"),
  sitioWeb: urlOpcional,
  linkedinUrl: urlOpcional,
  facebookUrl: urlOpcional,
  instagramUrl: urlOpcional
});

// Alta: el backend exige al menos un contacto con al menos un medio.
const contactoInicialSchema = z
  .object({
    contactoNombre: z.string().trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
    contactoPuesto: textoOpcional(160),
    contactoCorreo: correoOpcional,
    contactoTelefono: telefonoOpcional,
    contactoWhatsapp: telefonoOpcional
  })
  .refine((c) => c.contactoCorreo || c.contactoTelefono || c.contactoWhatsapp, {
    message: "Captura al menos un correo, teléfono o WhatsApp",
    path: ["contactoCorreo"]
  });

const altaSchema = empresaSchema.and(contactoInicialSchema);
// En edición el contacto inicial no existe: sus campos quedan sin validar.
const edicionSchema = empresaSchema.and(
  z.object({ contactoNombre: z.string(), contactoPuesto: z.string(), contactoCorreo: z.string(), contactoTelefono: z.string(), contactoWhatsapp: z.string() })
);
type AltaInput = z.infer<typeof altaSchema>;
type EmpresaInput = z.infer<typeof empresaSchema>;

function valoresEmpresa(empresa?: EmpresaDetalle): EmpresaInput {
  return {
    nombreLegal: empresa?.nombre_legal ?? "",
    nombreComercial: empresa?.nombre_comercial ?? "",
    giro: empresa?.giro ?? "",
    tamano: empresa?.tamano ?? "",
    region: empresa?.region ?? "",
    estado: empresa?.estado ?? "",
    ciudad: empresa?.ciudad ?? "",
    pais: empresa?.pais ?? "MX",
    sitioWeb: empresa?.sitio_web ?? "",
    linkedinUrl: empresa?.linkedin_url ?? "",
    facebookUrl: empresa?.facebook_url ?? "",
    instagramUrl: empresa?.instagram_url ?? ""
  };
}

// Sin `empresa`: alta (POST /empresas, con su primer contacto) y al terminar
// abre la ficha nueva. Con `empresa`: edición (PATCH /empresas/:id) de los
// datos de la empresa; los contactos se editan aparte, en ContactoForm.
export function EmpresaForm({ empresa, onDone }: { empresa?: EmpresaDetalle; onDone: () => void }) {
  const esAlta = !empresa;
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, dirtyFields }
  } = useForm<AltaInput>({
    resolver: zodResolver(esAlta ? altaSchema : edicionSchema),
    defaultValues: { ...valoresEmpresa(empresa), contactoNombre: "", contactoPuesto: "", contactoCorreo: "", contactoTelefono: "", contactoWhatsapp: "" }
  });

  async function onSubmit(values: AltaInput) {
    setServerError(null);
    const { contactoNombre, contactoPuesto, contactoCorreo, contactoTelefono, contactoWhatsapp, tamano, pais, ...texto } = values;
    try {
      if (esAlta) {
        const { id } = await api.post<{ id: number }>("/api/v1/empresas", {
          ...sinVacios(texto),
          tamano: tamano || undefined,
          pais: pais.toUpperCase(),
          contactos: [sinVacios({ nombre: contactoNombre, puesto: contactoPuesto, correo: contactoCorreo, telefono: contactoTelefono, whatsapp: contactoWhatsapp })]
        });
        await queryClient.invalidateQueries({ queryKey: ["empresas"] });
        navigate(`/empresas/${id}`);
        return;
      }

      const cambios: Record<string, unknown> = soloCambios(texto, dirtyFields);
      if (dirtyFields.tamano) cambios.tamano = tamano || null;
      if (dirtyFields.pais) cambios.pais = pais.toUpperCase();
      if (Object.keys(cambios).length > 0) {
        await api.patch(`/api/v1/empresas/${empresa.id}`, cambios);
        await queryClient.invalidateQueries({ queryKey: ["empresa", String(empresa.id)] });
        await queryClient.invalidateQueries({ queryKey: ["empresas"] });
      }
      onDone();
    } catch (error) {
      setServerError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="flex flex-col gap-4 border-b border-border bg-bg p-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Field label="Nombre legal" htmlFor="em-legal" error={errors.nombreLegal?.message}>
          <input id="em-legal" className={inputClass} {...register("nombreLegal")} />
        </Field>
        <Field label="Nombre comercial (opcional)" htmlFor="em-comercial" error={errors.nombreComercial?.message}>
          <input id="em-comercial" className={inputClass} {...register("nombreComercial")} />
        </Field>
        <Field label="Giro (opcional)" htmlFor="em-giro" error={errors.giro?.message}>
          <input id="em-giro" placeholder="Ej. Tratamiento de agua" className={inputClass} {...register("giro")} />
        </Field>
        <Field label="Tamaño (opcional)" htmlFor="em-tamano">
          <select id="em-tamano" className={inputClass} {...register("tamano")}>
            <option value="">— Sin dato —</option>
            {TAMANOS.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.etiqueta}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Región (opcional)" htmlFor="em-region" error={errors.region?.message}>
          <input id="em-region" placeholder="Ej. Bajío" className={inputClass} {...register("region")} />
        </Field>
        <Field label="Estado (opcional)" htmlFor="em-estado" error={errors.estado?.message}>
          <input id="em-estado" className={inputClass} {...register("estado")} />
        </Field>
        <Field label="Ciudad (opcional)" htmlFor="em-ciudad" error={errors.ciudad?.message}>
          <input id="em-ciudad" className={inputClass} {...register("ciudad")} />
        </Field>
        <Field label="País" htmlFor="em-pais" error={errors.pais?.message}>
          <input id="em-pais" maxLength={2} className={`${inputClass} uppercase`} {...register("pais")} />
        </Field>
        <Field label="Sitio web (opcional)" htmlFor="em-web" error={errors.sitioWeb?.message}>
          <input id="em-web" placeholder="https://" className={inputClass} {...register("sitioWeb")} />
        </Field>
        <Field label="LinkedIn (opcional)" htmlFor="em-linkedin" error={errors.linkedinUrl?.message}>
          <input id="em-linkedin" placeholder="https://" className={inputClass} {...register("linkedinUrl")} />
        </Field>
        <Field label="Facebook (opcional)" htmlFor="em-facebook" error={errors.facebookUrl?.message}>
          <input id="em-facebook" placeholder="https://" className={inputClass} {...register("facebookUrl")} />
        </Field>
        <Field label="Instagram (opcional)" htmlFor="em-instagram" error={errors.instagramUrl?.message}>
          <input id="em-instagram" placeholder="https://" className={inputClass} {...register("instagramUrl")} />
        </Field>
      </div>

      {esAlta && (
        <>
          <div className="text-xs font-bold uppercase tracking-wide text-ink-2">Contacto principal</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Nombre" htmlFor="em-c-nombre" error={errors.contactoNombre?.message}>
              <input id="em-c-nombre" className={inputClass} {...register("contactoNombre")} />
            </Field>
            <Field label="Puesto (opcional)" htmlFor="em-c-puesto" error={errors.contactoPuesto?.message}>
              <input id="em-c-puesto" className={inputClass} {...register("contactoPuesto")} />
            </Field>
            <Field label="Correo" htmlFor="em-c-correo" error={errors.contactoCorreo?.message}>
              <input id="em-c-correo" type="email" className={inputClass} {...register("contactoCorreo")} />
            </Field>
            <Field label="Teléfono" htmlFor="em-c-telefono" error={errors.contactoTelefono?.message}>
              <input id="em-c-telefono" inputMode="tel" className={inputClass} {...register("contactoTelefono")} />
            </Field>
            <Field label="WhatsApp" htmlFor="em-c-whatsapp" error={errors.contactoWhatsapp?.message}>
              <input id="em-c-whatsapp" inputMode="tel" className={inputClass} {...register("contactoWhatsapp")} />
            </Field>
          </div>
          <div className="text-xs text-ink-3">Se necesita al menos un correo, teléfono o WhatsApp. Podrás agregar más contactos desde la ficha.</div>
        </>
      )}

      <ServerError message={serverError} />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : esAlta ? "Crear empresa" : "Guardar cambios"}
        </Button>
      </div>
    </form>
  );
}
