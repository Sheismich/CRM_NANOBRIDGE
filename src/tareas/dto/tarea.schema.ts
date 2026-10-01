import { z } from "zod";
import { CLASIFICACIONES_MANUALES } from "../../shared/clasificaciones.js";

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

export const asignarTareaSchema = z.object({
  responsableId: z.coerce.number().int().positive()
});

export const cerrarTareaSchema = z.object({
  resultado: z.string().trim().min(2).max(4000)
});

// fechaSeguimiento: obligatoria (y futura) solo con "reagendar", que crea
// una tarea de seguimiento para esa fecha; con cualquier otra clasificación
// se rechaza en vez de ignorarse en silencio.
export const clasificarTareaSchema = z.object({
  clasificacion: z.enum(CLASIFICACIONES_MANUALES),
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
  responsableId: z.coerce.number().int().positive().optional(),
  // Las tareas que crea n8n llegan sin responsable: un supervisor las
  // filtra así para repartirlas. Mismo mapeo explícito que `cerrada` en
  // oportunidades (z.coerce.boolean() tomaría "false" como true).
  sinAsignar: z.enum(["true", "false"]).optional().transform((v) => (v === undefined ? undefined : v === "true"))
}).refine((q) => !(q.sinAsignar && q.responsableId), { path: ["sinAsignar"], message: "No se combina con responsableId" });

export type CrearTareaInput = z.infer<typeof crearTareaSchema>;
export type ClasificarTareaInput = z.infer<typeof clasificarTareaSchema>;
