import { z } from "zod";

export const respuestaIdSchema = z.coerce.number().int().positive();

export const contestarInputSchema = z.object({
  texto: z.string().trim().min(1, "Escribe la respuesta").max(5000),
  // El borrador de la IA del que salió (si salió de uno), para P3.11.
  borrador_id: z.coerce.number().int().positive().optional(),
  // P3.8: casilla "Marcar la tarea como hecha", encendida por defecto.
  cerrar_tarea: z.boolean().default(true)
});
export type ContestarInput = z.infer<typeof contestarInputSchema>;
