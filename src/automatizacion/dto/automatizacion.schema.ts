import { z } from "zod";

// --- Scoring -----------------------------------------------------------------
export const scoringInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  prospecto_id: z.coerce.number().int().positive(),
  score: z.coerce.number().min(0).max(100),
  prioridad: z.enum(["alta", "media", "baja"]).optional(),
  confianza: z.enum(["alta", "media", "baja"]).optional(),
  metodo: z.enum(["gemini", "reglas"]),
  detalle: z.record(z.string(), z.unknown()).optional()
});
export type ScoringInput = z.infer<typeof scoringInputSchema>;

// --- Incidencias ---------------------------------------------------------------
export const incidenciaInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100).optional(),
  prospecto_id: z.coerce.number().int().positive().optional(),
  tipo: z.string().trim().min(2).max(60),
  severidad: z.enum(["baja", "media", "alta"]).default("media"),
  mensaje: z.string().trim().min(1).max(2000),
  detalle: z.record(z.string(), z.unknown()).optional()
});
export type IncidenciaInput = z.infer<typeof incidenciaInputSchema>;

// --- Registro de prospecto -----------------------------------------------------
export const registroProspectoInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  empresa: z.object({
    nombreLegal: z.string().trim().min(2).max(255),
    nombreComercial: z.string().trim().max(255).optional(),
    giro: z.string().trim().max(120).optional(),
    tamano: z.enum(["micro", "pequena", "mediana", "grande"]).optional(),
    region: z.string().trim().max(120).optional(),
    estado: z.string().trim().max(120).optional(),
    ciudad: z.string().trim().max(120).optional(),
    pais: z.string().length(2).default("MX"),
    sitioWeb: z.string().url().max(2048).optional(),
    linkedinUrl: z.string().url().max(2048).optional()
  }),
  contacto: z.object({
    nombre: z.string().trim().min(2).max(160),
    puesto: z.string().trim().max(160).optional(),
    area: z.string().trim().max(160).optional(),
    correo: z.string().trim().email().max(254).optional(),
    telefono: z.string().trim().min(7).max(40).optional()
  }).refine((input) => input.correo || input.telefono, { message: "El contacto requiere correo o teléfono para poder deduplicar" }),
  campana_id: z.coerce.number().int().positive().optional(),
  fuente_url: z.string().url().max(2048).optional(),
  confianza: z.enum(["alta", "media", "baja"]).optional()
});
export type RegistroProspectoInput = z.infer<typeof registroProspectoInputSchema>;

// --- Validaciones --------------------------------------------------------------
export const validacionInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  prospecto_id: z.coerce.number().int().positive()
});
export type ValidacionInput = z.infer<typeof validacionInputSchema>;

// --- Supresión -----------------------------------------------------------------
export const consultaSupresionQuerySchema = z.object({
  tipo: z.enum(["correo", "telefono", "whatsapp"]),
  valor: z.string().trim().min(1).max(512)
});
export type ConsultaSupresionQuery = z.infer<typeof consultaSupresionQuerySchema>;

export const registroSupresionInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  tipo: z.enum(["correo", "telefono", "whatsapp"]),
  valor: z.string().trim().min(1).max(512),
  motivo: z.string().trim().min(2).max(255)
});
export type RegistroSupresionInput = z.infer<typeof registroSupresionInputSchema>;

// --- Campaña activa --------------------------------------------------------------
export const campanaActivaQuerySchema = z.object({
  campana_id: z.coerce.number().int().positive()
});
export type CampanaActivaQuery = z.infer<typeof campanaActivaQuerySchema>;

// --- Estado de prospecto ---------------------------------------------------------
export const estadoProspectoInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  prospecto_id: z.coerce.number().int().positive(),
  estado: z.enum(["descartado", "excluido", "inactivo"]),
  motivo: z.string().trim().min(2).max(255)
});
export type EstadoProspectoInput = z.infer<typeof estadoProspectoInputSchema>;

// --- Tareas (creadas por n8n) ----------------------------------------------------
export const tareaAutomatizacionInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  prospecto_id: z.coerce.number().int().positive().optional(),
  tipo: z.enum(["seguimiento", "clasificacion", "revision_documento", "otro"]).default("seguimiento"),
  titulo: z.string().trim().min(2).max(255),
  descripcion: z.string().trim().max(4000).optional(),
  prioridad: z.enum(["baja", "media", "alta", "urgente"]).default("media"),
  fecha_limite: z.string().datetime().optional()
});
export type TareaAutomatizacionInput = z.infer<typeof tareaAutomatizacionInputSchema>;
