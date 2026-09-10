import { z } from "zod";

const PARTIDA_MAX = 50;

export const partidaInputSchema = z.object({
  descripcion: z.string().trim().min(2).max(255),
  cantidad: z.coerce.number().positive().max(1_000_000),
  precioUnitario: z.coerce.number().min(0).max(100_000_000)
});
export type PartidaInput = z.infer<typeof partidaInputSchema>;

// Campos que se repiten al crear la v1 y al crear una nueva versión: la
// empresa y la oportunidad NO cambian entre versiones de la misma
// cotización (ver cotizacionRaizId en el schema), así que solo viven en
// crearCotizacionSchema, no aquí.
export const datosCotizacionSchema = z.object({
  contactoId: z.coerce.number().int().positive().optional(),
  descuento: z.coerce.number().min(0).default(0),
  impuestos: z.coerce.number().min(0).default(0),
  fechaEsperadaCierre: z.string().date().optional(),
  probabilidad: z.coerce.number().int().min(0).max(100).optional(),
  partidas: z.array(partidaInputSchema).min(1).max(PARTIDA_MAX)
});
export type DatosCotizacionInput = z.infer<typeof datosCotizacionSchema>;

export const crearCotizacionSchema = datosCotizacionSchema.extend({
  empresaId: z.coerce.number().int().positive(),
  oportunidadId: z.coerce.number().int().positive()
});
export type CrearCotizacionInput = z.infer<typeof crearCotizacionSchema>;

export const listCotizacionesQuerySchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});
export type ListCotizacionesQuery = z.infer<typeof listCotizacionesQuerySchema>;

export const cambiarEstadoCotizacionSchema = z.object({
  estado: z.enum(["enviada", "aceptada", "rechazada", "vencida"])
});
export type CambiarEstadoCotizacionInput = z.infer<typeof cambiarEstadoCotizacionSchema>;
