import { z } from "zod";

const fechaSchema = z.string().date();

function fechaInicioAntesDeFechaFin(input: { fechaInicio?: string | null; fechaFin?: string | null }) {
  return !input.fechaInicio || !input.fechaFin || input.fechaInicio <= input.fechaFin;
}
export const ERROR_RANGO_FECHAS_CAMPANA = "fechaInicio debe ser anterior o igual a fechaFin";

// canal: solo correo. WhatsApp sigue apagado hasta tener proveedor aprobado
// (parámetro whatsapp_habilitado = false), así que se rechaza con 400 en vez
// de crear una campaña que nunca podría mandar.
export const crearCampanaSchema = z.object({
  nombre: z.string().trim().min(2).max(160),
  canal: z.enum(["correo"]).default("correo"),
  fechaInicio: fechaSchema.optional(),
  fechaFin: fechaSchema.optional()
}).refine(fechaInicioAntesDeFechaFin, { message: ERROR_RANGO_FECHAS_CAMPANA, path: ["fechaFin"] });

// PATCH parcial: un campo ausente no se toca; null quita la fecha. El rango
// se valida en el servicio contra lo que ya está guardado.
export const editarCampanaSchema = z.object({
  nombre: z.string().trim().min(2).max(160).optional(),
  fechaInicio: fechaSchema.nullable().optional(),
  fechaFin: fechaSchema.nullable().optional()
});

export const listCampanasQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.enum(["borrador", "activa", "pausada", "finalizada"]).optional()
});

export type CrearCampanaInput = z.infer<typeof crearCampanaSchema>;
export type EditarCampanaInput = z.infer<typeof editarCampanaSchema>;
export type ListCampanasQuery = z.infer<typeof listCampanasQuerySchema>;
