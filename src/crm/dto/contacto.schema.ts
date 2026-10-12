import { z } from "zod";
import { contactInputSchema } from "./empresa.schema.js";

// Alta en /contactos: mismo cuerpo que POST /empresas/:id/contactos, más la
// empresa a la que pertenece (en la ruta anidada esa viene en la URL). Se
// compone con .and() en vez de .extend() porque contactInputSchema lleva un
// .refine ("al menos un medio de contacto") que no sobrevive a .extend().
export const createContactoSchema = z.object({ empresaId: z.number().int().positive() }).and(contactInputSchema);

export const listContactosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  empresaId: z.coerce.number().int().positive().optional(),
  // Busca en el nombre, el correo o teléfono y el nombre de la empresa.
  q: z.string().trim().max(160).optional(),
  // A quién se le puede escribir (lista de Contactos, 9-oct-2026):
  // escribible = algún correo/teléfono/WhatsApp activo; no_contactar = ninguno
  // activo y alguno en no_contactar (pidió su baja); sin_medio = ni lo uno ni
  // lo otro (sin medio o solo obsoletos).
  estado: z.enum(["escribible", "no_contactar", "sin_medio"]).optional()
});

export const conteosContactosQuerySchema = z.object({
  empresaId: z.coerce.number().int().positive().optional()
});
export type ConteosContactosQuery = z.infer<typeof conteosContactosQuerySchema>;

export type CreateContactoInput = z.infer<typeof createContactoSchema>;
export type ListContactosQuery = z.infer<typeof listContactosQuerySchema>;
