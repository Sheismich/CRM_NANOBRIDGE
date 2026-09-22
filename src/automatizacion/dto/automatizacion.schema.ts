import { z } from "zod";
import { httpUrlSchema } from "../../shared/http-url.js";
import { tieneDigitosSuficientes } from "../../shared/normalize.js";

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

// --- Error de workflow (B4, PLAN_N8N_DEFINITIVO.md) -----------------------------
// El Error Trigger global de n8n llama esto UNA vez por ejecución fallida,
// sin importar el workflow/nodo donde haya tronado. A diferencia de
// incidenciaInputSchema, aquí execution_id es OBLIGATORIO: es la clave de
// idempotencia de este endpoint (ver uq_incidencias_execution_tipo en
// 004_scoring_e_incidencias.sql, con el `tipo` fijo que usa
// registrarErrorWorkflow), no un dato opcional de trazabilidad.
export const errorWorkflowInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  workflow: z.string().trim().min(1).max(120).optional(),
  nodo: z.string().trim().min(1).max(120).optional(),
  endpoint: z.string().trim().min(1).max(160).optional(),
  codigo_http: z.coerce.number().int().min(100).max(599).optional(),
  mensaje: z.string().trim().min(1).max(2000),
  critico: z.boolean().default(false),
  prospecto_id: z.coerce.number().int().positive().optional(),
  detalle: z.record(z.string(), z.unknown()).optional()
});
export type ErrorWorkflowInput = z.infer<typeof errorWorkflowInputSchema>;

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
    sitioWeb: httpUrlSchema.optional(),
    linkedinUrl: httpUrlSchema.optional()
  }),
  contacto: z.object({
    nombre: z.string().trim().min(2).max(160),
    puesto: z.string().trim().max(160).optional(),
    area: z.string().trim().max(160).optional(),
    correo: z.string().trim().email().max(254).optional(),
    // .refine adicional (hallazgo de code review, 14-sep-2026): ver
    // tieneDigitosSuficientes() en shared/normalize.ts.
    telefono: z.string().trim().min(7).max(40).refine(tieneDigitosSuficientes, { message: "El teléfono debe contener al menos 7 dígitos" }).optional()
  }).refine((input) => input.correo || input.telefono, { message: "El contacto requiere correo o teléfono para poder deduplicar" }),
  campana_id: z.coerce.number().int().positive().optional(),
  fuente_url: httpUrlSchema.optional(),
  confianza: z.enum(["alta", "media", "baja"]).optional()
});
export type RegistroProspectoInput = z.infer<typeof registroProspectoInputSchema>;

// --- Consulta de prospecto para scoring -------------------------------------------
export const consultaProspectoScoringQuerySchema = z.object({
  prospecto_id: z.coerce.number().int().positive()
});
export type ConsultaProspectoScoringQuery = z.infer<typeof consultaProspectoScoringQuerySchema>;

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

// --- Verificación / Registro de envío ---------------------------------------------
export const verificacionEnvioQuerySchema = z.object({
  prospecto_id: z.coerce.number().int().positive(),
  canal: z.enum(["correo", "whatsapp"]).default("correo")
});
export type VerificacionEnvioQuery = z.infer<typeof verificacionEnvioQuerySchema>;

export const registroEnvioInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  prospecto_id: z.coerce.number().int().positive(),
  canal: z.enum(["correo", "whatsapp"]).default("correo")
});
export type RegistroEnvioInput = z.infer<typeof registroEnvioInputSchema>;

// --- Respuesta recibida --------------------------------------------------------------
export const respuestaRecibidaInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  prospecto_id: z.coerce.number().int().positive(),
  canal: z.enum(["correo", "whatsapp"]).default("correo"),
  contenido: z.string().trim().max(8000).optional()
});
export type RespuestaRecibidaInput = z.infer<typeof respuestaRecibidaInputSchema>;

// --- Respuesta clasificada -------------------------------------------------------------
export const respuestaClasificadaInputSchema = z.object({
  execution_id: z.string().trim().min(1).max(100),
  respuesta_id: z.coerce.number().int().positive(),
  clasificacion: z.enum(["interesado", "no_interesado", "baja", "automatica", "ambigua"]),
  comentario: z.string().trim().max(500).optional()
});
export type RespuestaClasificadaInput = z.infer<typeof respuestaClasificadaInputSchema>;

// --- Ventanas vencidas -------------------------------------------------------------
export const ventanasVencidasQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50)
});
export type VentanasVencidasQuery = z.infer<typeof ventanasVencidasQuerySchema>;

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
