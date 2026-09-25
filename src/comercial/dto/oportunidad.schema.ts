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
  // Falta desde la primera versión de este módulo -- documentos y
  // cotizaciones (que cuelgan de una oportunidad) sí filtran por
  // empresaId en su propio listado; sin este mismo filtro aquí, una
  // pantalla de "oportunidades de esta empresa" (Ficha de cliente,
  // PLAN_FRONTEND.md §5) no tenía forma de pedirlo al servidor (hallazgo
  // al construir esa pantalla, 24-sep-2026).
  empresaId: z.coerce.number().int().positive().optional(),
  etapaClave: z.enum(ETAPA_CLAVES).optional(),
  // z.coerce.boolean() hace Boolean(valor) sobre el string crudo -- "false"
  // es un string no vacío, así que coercionaría a true. Mapeo explícito en
  // vez de confiar en la coerción automática de zod.
  cerrada: z.enum(["true", "false"]).optional().transform((value) => (value === undefined ? undefined : value === "true")),
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
