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
  q: z.string().trim().max(160).optional()
});

export type CreateContactoInput = z.infer<typeof createContactoSchema>;
export type ListContactosQuery = z.infer<typeof listContactosQuerySchema>;
