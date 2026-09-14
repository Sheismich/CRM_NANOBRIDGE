import { z } from "zod";

const PARTIDA_MAX = 50;
// cotizacion_partidas.importe y cotizaciones.subtotal/descuento/impuestos/
// total son DECIMAL(12,2): 10 dígitos enteros + 2 decimales, tope real
// 9,999,999,999.99. cantidad*precioUnitario y descuento/impuestos se
// validaban cada uno por separado sin tope conjunto, así que un valor
// dentro de sus límites individuales podía desbordar la columna igual
// (hallazgo de code review, 11-sep-2026).
const MAX_MONTO = 9_999_999_999.99;

export const partidaInputSchema = z.object({
  descripcion: z.string().trim().min(2).max(255),
  cantidad: z.coerce.number().positive().max(1_000_000),
  precioUnitario: z.coerce.number().min(0).max(100_000_000)
});
export type PartidaInput = z.infer<typeof partidaInputSchema>;

// Valida que el subtotal (suma de cantidad*precioUnitario) y el total
// (subtotal - descuento + impuestos) quepan en DECIMAL(12,2) y que el
// descuento no vuelva el total negativo. Se comparte entre
// datosCotizacionSchema y crearCotizacionSchema (en vez de duplicar la
// cuenta en los dos) porque ambos se usan directamente con .parse() en el
// controller.
function validarMontos(data: { descuento: number; impuestos: number; partidas: PartidaInput[] }, ctx: z.RefinementCtx) {
  // Cada línea se redondea a 2 decimales ANTES de sumar -- igual que
  // CotizacionesService.calcular() hace al persistir (cotizacion_partidas.
  // importe es DECIMAL(12,2)). Antes este subtotal se calculaba sobre
  // cantidad*precioUnitario SIN redondear por línea, así que una
  // combinación de partidas que aquí validaba total=0.00 (o cualquier
  // valor no negativo) podía, una vez que calcular() redondea cada línea
  // por separado, terminar sumando un total negativo que este guard
  // debía haber rechazado pero nunca vio (hallazgo de code review,
  // 14-sep-2026).
  const subtotal = Number(data.partidas.reduce((acc, p) => acc + Number((p.cantidad * p.precioUnitario).toFixed(2)), 0).toFixed(2));
  if (subtotal > MAX_MONTO) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partidas"], message: `El subtotal (suma de cantidad × precio unitario) no puede exceder ${MAX_MONTO}` });
    return;
  }
  const total = Number((subtotal - data.descuento + data.impuestos).toFixed(2));
  if (total < 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["descuento"], message: "El descuento no puede exceder subtotal + impuestos" });
  } else if (total > MAX_MONTO) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["impuestos"], message: `El total no puede exceder ${MAX_MONTO}` });
  }
}

// Campos que se repiten al crear la v1 y al crear una nueva versión: la
// empresa y la oportunidad NO cambian entre versiones de la misma
// cotización (ver cotizacionRaizId en el schema), así que solo viven en
// crearCotizacionSchema, no aquí.
const datosCotizacionShape = z.object({
  contactoId: z.coerce.number().int().positive().optional(),
  descuento: z.coerce.number().min(0).max(MAX_MONTO).default(0),
  impuestos: z.coerce.number().min(0).max(MAX_MONTO).default(0),
  fechaEsperadaCierre: z.string().date().optional(),
  probabilidad: z.coerce.number().int().min(0).max(100).optional(),
  partidas: z.array(partidaInputSchema).min(1).max(PARTIDA_MAX)
});
export const datosCotizacionSchema = datosCotizacionShape.superRefine(validarMontos);
export type DatosCotizacionInput = z.infer<typeof datosCotizacionShape>;

export const crearCotizacionSchema = datosCotizacionShape
  .extend({
    empresaId: z.coerce.number().int().positive(),
    oportunidadId: z.coerce.number().int().positive()
  })
  .superRefine(validarMontos);
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
