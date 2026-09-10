import { z } from "zod";

// Fijas por ahora (sin pantalla de administración de catálogos en este
// alcance); viven como tabla real en MySQL (catalogo_etapa_embudo) para
// poder agregar una etapa nueva por SQL sin tocar el ENUM de una columna.
export const ETAPA_CLAVES = ["calificada", "descubrimiento", "propuesta", "negociacion", "verbalmente_ganada", "ganada", "perdida"] as const;
export const ETAPA_CLAVES_ACTIVAS = ["calificada", "descubrimiento", "propuesta", "negociacion", "verbalmente_ganada"] as const;
export const MOTIVO_PERDIDA_CLAVES = ["sin_presupuesto", "sin_necesidad", "sin_respuesta", "competidor", "fuera_de_perfil", "decision_pospuesta", "contacto_invalido", "otro"] as const;

export const crearOportunidadSchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  contactoId: z.coerce.number().int().positive().optional(),
  prospectoId: z.coerce.number().int().positive().optional(),
  titulo: z.string().trim().min(2).max(255),
  responsableId: z.coerce.number().int().positive().optional(),
  valorEstimado: z.coerce.number().min(0).optional(),
  fechaCierreEstimada: z.string().date().optional()
});
export type CrearOportunidadInput = z.infer<typeof crearOportunidadSchema>;

export const listOportunidadesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  etapaClave: z.enum(ETAPA_CLAVES).optional(),
  cerrada: z.coerce.boolean().optional(),
  responsableId: z.coerce.number().int().positive().optional()
});
export type ListOportunidadesQuery = z.infer<typeof listOportunidadesQuerySchema>;

export const cambiarEtapaSchema = z.object({
  etapaClave: z.enum(ETAPA_CLAVES),
  motivoPerdidaClave: z.enum(MOTIVO_PERDIDA_CLAVES).optional(),
  motivoPerdidaDetalle: z.string().trim().min(2).max(500).optional(),
  comentario: z.string().trim().max(500).optional()
}).refine((input) => input.etapaClave !== "perdida" || input.motivoPerdidaClave, {
  message: "Marcar una oportunidad como perdida requiere motivoPerdidaClave",
  path: ["motivoPerdidaClave"]
}).refine((input) => input.motivoPerdidaClave !== "otro" || input.motivoPerdidaDetalle, {
  message: "El motivo 'otro' requiere motivoPerdidaDetalle",
  path: ["motivoPerdidaDetalle"]
});
export type CambiarEtapaInput = z.infer<typeof cambiarEtapaSchema>;

export const reabrirOportunidadSchema = z.object({
  etapaClave: z.enum(ETAPA_CLAVES_ACTIVAS),
  comentario: z.string().trim().max(500).optional()
});
export type ReabrirOportunidadInput = z.infer<typeof reabrirOportunidadSchema>;
