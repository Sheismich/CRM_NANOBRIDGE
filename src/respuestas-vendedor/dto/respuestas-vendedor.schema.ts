import { z } from "zod";

export const respuestaIdSchema = z.coerce.number().int().positive();

// Para y copia (18-nov-2026): ids de medios_contacto (tipo correo) de
// contactos de la empresa. Hasta 10 en copia.
export const MAX_COPIAS = 10;
const medioIdSchema = z.coerce.number().int().positive();

export const contestarInputSchema = z.object({
  texto: z.string().trim().min(1, "Escribe la respuesta").max(5000),
  // El borrador de la IA del que salió (si salió de uno), para P3.11.
  borrador_id: z.coerce.number().int().positive().optional(),
  // P3.8: casilla "Marcar la tarea como hecha", encendida por defecto.
  cerrar_tarea: z.boolean().default(true),
  // Si no viene, el Para que propone el contexto (quien contestó, si se puede).
  para_medio_id: medioIdSchema.optional(),
  copia_medio_ids: z.array(medioIdSchema).max(MAX_COPIAS, `Máximo ${MAX_COPIAS} correos en copia`).default([])
});
export type ContestarInput = z.infer<typeof contestarInputSchema>;

// El borrador saluda a quien va en Para.
export const borradorInputSchema = z.object({ para_medio_id: medioIdSchema.optional() }).default({});
export type BorradorInput = z.infer<typeof borradorInputSchema>;
