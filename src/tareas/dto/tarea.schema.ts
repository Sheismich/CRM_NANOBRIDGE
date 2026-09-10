import { z } from "zod";

export const crearTareaSchema = z.object({
  tipo: z.enum(["seguimiento", "clasificacion", "revision_documento", "otro"]).default("seguimiento"),
  titulo: z.string().trim().min(2).max(255),
  descripcion: z.string().trim().max(4000).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  responsableId: z.coerce.number().int().positive(),
  empresaId: z.coerce.number().int().positive().optional(),
  contactoId: z.coerce.number().int().positive().optional(),
  prospectoId: z.coerce.number().int().positive().optional(),
  fechaLimite: z.coerce.date().optional()
});

export const cerrarTareaSchema = z.object({
  resultado: z.string().trim().min(2).max(4000)
});

export const clasificarTareaSchema = z.object({
  clasificacion: z.enum(["interesado", "no_interesado", "invalido", "reagendar"]),
  comentario: z.string().trim().max(4000).optional()
});

export const listTareasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.enum(["pendiente", "en_progreso", "cerrada", "cancelada"]).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).optional(),
  tipo: z.enum(["seguimiento", "clasificacion", "revision_documento", "otro"]).optional(),
  responsableId: z.coerce.number().int().positive().optional()
});

export type CrearTareaInput = z.infer<typeof crearTareaSchema>;
export type ClasificarTareaInput = z.infer<typeof clasificarTareaSchema>;
