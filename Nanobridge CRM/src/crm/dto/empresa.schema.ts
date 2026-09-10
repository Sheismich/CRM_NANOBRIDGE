import { z } from "zod";

export const contactInputSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  puesto: z.string().trim().max(160).optional(),
  area: z.string().trim().max(160).optional(),
  correo: z.string().trim().email().max(254).optional(),
  telefono: z.string().trim().min(7).max(40).optional(),
  whatsapp: z.string().trim().min(7).max(40).optional()
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
  sitioWeb: z.string().url().max(2048).optional(),
  linkedinUrl: z.string().url().max(2048).optional(),
  contactos: z.array(contactInputSchema).min(1).max(50)
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export type CompanyInput = z.infer<typeof companyInputSchema>;
