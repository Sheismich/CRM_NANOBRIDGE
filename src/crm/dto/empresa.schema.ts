import { z } from "zod";
import { tieneDigitosSuficientes } from "../../shared/normalize.js";
import { httpUrlSchema } from "../../shared/http-url.js";

// min(7)/max(40) sobre el texto crudo no basta para "parece un teléfono"
// (ver tieneDigitosSuficientes en shared/normalize.ts, hallazgo de code
// review, 14-sep-2026): sin el .refine, un valor como "no-phone" pasaba la
// validación pero normalizePhone() lo dejaba en "" e insertarMediosContacto()
// lo descartaba en silencio.
const telefonoSchema = z.string().trim().min(7).max(40).refine(tieneDigitosSuficientes, { message: "El teléfono debe contener al menos 7 dígitos" });

export const contactInputSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  puesto: z.string().trim().max(160).optional(),
  area: z.string().trim().max(160).optional(),
  linkedinUrl: httpUrlSchema.optional(),
  facebookUrl: httpUrlSchema.optional(),
  instagramUrl: httpUrlSchema.optional(),
  correo: z.string().trim().email().max(254).optional(),
  telefono: telefonoSchema.optional(),
  whatsapp: telefonoSchema.optional()
}).refine((input) => input.correo || input.telefono || input.whatsapp, { message: "Cada contacto requiere al menos un medio de contacto" });

export const companyInputSchema = z.object({
  nombreLegal: z.string().trim().min(2).max(255),
  nombreComercial: z.string().trim().max(255).optional(),
  giro: z.string().trim().max(120).optional(),
  tamano: z.enum(["micro", "pequena", "mediana", "grande"]).optional(),
  region: z.string().trim().max(120).optional(),
  estado: z.string().trim().max(120).optional(),
  ciudad: z.string().trim().max(120).optional(),
  pais: z.string().length(2).default("MX"),
  sitioWeb: httpUrlSchema.optional(),
  linkedinUrl: httpUrlSchema.optional(),
  facebookUrl: httpUrlSchema.optional(),
  instagramUrl: httpUrlSchema.optional(),
  contactos: z.array(contactInputSchema).min(1).max(50)
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

// --- Actualización de empresa ---------------------------------------------
// Todos los campos opcionales (PATCH parcial): un campo ausente deja el
// valor actual sin tocar. A diferencia de companyInputSchema, `pais` NO
// lleva .default("MX") -- con .partial() un default se aplicaría igual
// cuando el campo se omite, y sobrescribiría silenciosamente el país ya
// guardado con "MX" en cada edición que no lo mencione.
export const updateCompanySchema = z.object({
  nombreLegal: z.string().trim().min(2).max(255).optional(),
  nombreComercial: z.string().trim().max(255).nullable().optional(),
  giro: z.string().trim().max(120).nullable().optional(),
  tamano: z.enum(["micro", "pequena", "mediana", "grande"]).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  estado: z.string().trim().max(120).nullable().optional(),
  ciudad: z.string().trim().max(120).nullable().optional(),
  pais: z.string().length(2).optional(),
  sitioWeb: httpUrlSchema.nullable().optional(),
  linkedinUrl: httpUrlSchema.nullable().optional(),
  facebookUrl: httpUrlSchema.nullable().optional(),
  instagramUrl: httpUrlSchema.nullable().optional()
}).refine((data) => Object.keys(data).length > 0, { message: "Debes incluir al menos un campo para actualizar" });

// --- Alta y edición de contacto --------------------------------------------
// updateContactSchema: cada campo ausente deja el valor actual sin tocar;
// correo/telefono/whatsapp además aceptan null explícito para "borrar" ese
// medio (se marca obsoleto, nunca se elimina la fila -- PLAN_CRM_DEFINITIVO.md
// #2: "no se borra información; se desactiva o se marca como obsoleta").
export const updateContactSchema = z.object({
  nombre: z.string().trim().min(2).max(160).optional(),
  puesto: z.string().trim().max(160).nullable().optional(),
  area: z.string().trim().max(160).nullable().optional(),
  linkedinUrl: httpUrlSchema.nullable().optional(),
  facebookUrl: httpUrlSchema.nullable().optional(),
  instagramUrl: httpUrlSchema.nullable().optional(),
  correo: z.string().trim().email().max(254).nullable().optional(),
  telefono: telefonoSchema.nullable().optional(),
  whatsapp: telefonoSchema.nullable().optional()
}).refine((data) => Object.keys(data).length > 0, { message: "Debes incluir al menos un campo para actualizar" });

export type CompanyInput = z.infer<typeof companyInputSchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
