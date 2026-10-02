import { z } from "zod";

const DIAS_ATRAS_ACTIVIDAD = 7;

export const crearActividadSchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  contactoId: z.coerce.number().int().positive().optional(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  tipo: z.enum(["llamada", "whatsapp", "comentario"]),
  resultado: z.string().trim().max(255).optional(),
  proximaAccion: z.string().trim().max(255).optional(),
  comentario: z.string().trim().max(4000).optional(),
  // Entre hace 7 días y ahora (5 minutos de tolerancia por relojes
  // adelantados). Las actividades cuentan en "Desempeño por agente": con
  // cualquier fecha se inflaba otro periodo (D4 del plan de fixes,
  // 2-oct-2026). Se calcula al validar cada petición, no al cargar el módulo.
  ocurridaEn: z.coerce.date().optional().refine((fecha) => {
    if (!fecha) return true;
    const ahora = Date.now();
    return fecha.getTime() >= ahora - DIAS_ATRAS_ACTIVIDAD * 86_400_000 && fecha.getTime() <= ahora + 5 * 60_000;
  }, { message: "La fecha tiene que ser de los últimos 7 días, no futura" })
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
