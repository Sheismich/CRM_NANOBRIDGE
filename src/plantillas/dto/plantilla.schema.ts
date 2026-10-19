import { z } from "zod";

// Solo texto: asunto en una línea, cuerpo con párrafos (shared/plantillas.ts).
export const numeroPlantillaSchema = z.coerce.number().int().min(1).max(3);

export const editarPlantillaSchema = z.object({
  asunto: z.string().trim().min(3).max(200).refine((a) => !/[\r\n]/.test(a), { message: "El asunto va en una sola línea" }),
  cuerpo: z.string().trim().min(10).max(5000)
});

export const editarPieSchema = z.object({
  texto: z.string().trim().max(1000)
});

// pie ausente = el guardado; así la vista previa del pie muestra lo que se
// está escribiendo antes de guardarlo.
export const vistaPreviaSchema = z.object({
  asunto: z.string().max(200),
  cuerpo: z.string().max(5000),
  pie: z.string().max(1000).optional(),
  prospecto_id: z.number().int().positive().optional()
});

export type EditarPlantillaInput = z.infer<typeof editarPlantillaSchema>;
export type EditarPieInput = z.infer<typeof editarPieSchema>;
export type VistaPreviaInput = z.infer<typeof vistaPreviaSchema>;
