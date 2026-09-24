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

// fechaSeguimiento: obligatoria (y futura) solo con "reagendar", que crea
// una tarea de seguimiento para esa fecha; con cualquier otra clasificación
// se rechaza en vez de ignorarse en silencio.
export const clasificarTareaSchema = z.object({
  clasificacion: z.enum(["interesado", "no_interesado", "baja", "invalido", "reagendar"]),
  comentario: z.string().trim().max(4000).optional(),
  fechaSeguimiento: z.coerce.date().optional()
}).superRefine((input, ctx) => {
  if (input.clasificacion !== "reagendar") {
    if (input.fechaSeguimiento) ctx.addIssue({ code: "custom", path: ["fechaSeguimiento"], message: "Solo se acepta con la clasificación 'reagendar'" });
    return;
  }
  if (!input.fechaSeguimiento) {
    ctx.addIssue({ code: "custom", path: ["fechaSeguimiento"], message: "Obligatoria para 'reagendar'" });
  } else if (input.fechaSeguimiento.getTime() <= Date.now()) {
    ctx.addIssue({ code: "custom", path: ["fechaSeguimiento"], message: "Debe ser una fecha futura" });
  }
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
