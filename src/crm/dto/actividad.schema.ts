import { z } from "zod";

export const crearActividadSchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  contactoId: z.coerce.number().int().positive().optional(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  tipo: z.enum(["llamada", "whatsapp", "comentario"]),
  resultado: z.string().trim().max(255).optional(),
  proximaAccion: z.string().trim().max(255).optional(),
  comentario: z.string().trim().max(4000).optional(),
  ocurridaEn: z.coerce.date().optional()
});
export type CrearActividadInput = z.infer<typeof crearActividadSchema>;

// contactoId y oportunidadId son mutuamente excluyentes: acotan de forma
// distinta qué fuentes de la línea de tiempo aplican (ver comentario en
// actividades.service.ts).
export const timelineQuerySchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  contactoId: z.coerce.number().int().positive().optional(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
}).refine((input) => !(input.contactoId && input.oportunidadId), {
  message: "Especifica contactoId u oportunidadId, no ambos",
  path: ["oportunidadId"]
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;
