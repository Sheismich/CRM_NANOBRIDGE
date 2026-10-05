import { z } from "zod";
import { aCentavos, calcularCotizacion, tieneMaxDosDecimales } from "../dinero.js";

const PARTIDA_MAX = 50;
// cotizacion_partidas.importe y cotizaciones.subtotal/descuento/impuestos/
// total son DECIMAL(12,2): 10 dígitos enteros + 2 decimales, tope real
// 9,999,999,999.99. cantidad*precioUnitario y descuento/impuestos se
// validaban cada uno por separado sin tope conjunto, así que un valor
// dentro de sus límites individuales podía desbordar la columna igual
// (hallazgo de code review, 11-sep-2026).
const MAX_MONTO = 9_999_999_999.99;
const MAX_MONTO_CENTAVOS = aCentavos(MAX_MONTO);

// Dinero y cantidades con a lo más 2 decimales, lo que guardan sus columnas
// DECIMAL(x,2) (D1, 5-oct-2026): antes 0.333 se aceptaba, se calculaba con
// él y la base guardaba 0.33 -- lo guardado no cuadraba con el importe.
const DOS_DECIMALES = "Máximo 2 decimales";

export const partidaInputSchema = z.object({
  descripcion: z.string().trim().min(2).max(255),
  cantidad: z.coerce.number().positive().max(1_000_000).refine(tieneMaxDosDecimales, DOS_DECIMALES),
  precioUnitario: z.coerce.number().min(0).max(100_000_000).refine(tieneMaxDosDecimales, DOS_DECIMALES)
});
export type PartidaInput = z.infer<typeof partidaInputSchema>;

// Valida que el subtotal (suma de cantidad*precioUnitario) y el total
// (subtotal - descuento + impuestos) quepan en DECIMAL(12,2) y que el
// descuento no pase del subtotal (D1, 5-oct-2026: antes bastaba con que los
// impuestos lo cubrieran, y un descuento mayor que lo vendido pasaba). Se
// comparte entre datosCotizacionSchema y crearCotizacionSchema (en vez de
// duplicar la cuenta en los dos) porque ambos se usan directamente con
// .parse() en el controller.
function validarMontos(data: { descuento: number; impuestos: number; partidas: PartidaInput[] }, ctx: z.RefinementCtx) {
  // La MISMA cuenta que CotizacionesService.calcular() (comercial/dinero.ts):
  // cada línea redondeada a centavos antes de sumar. Si aquí se calculara
  // distinto, una cotización que esta validación aprueba podría guardarse
  // con otro total (hallazgo de code review, 14-sep-2026).
  if (!tieneMaxDosDecimales(data.descuento) || !tieneMaxDosDecimales(data.impuestos)) return;
  const { subtotal, total } = calcularCotizacion(data.partidas, data.descuento, data.impuestos);
  if (subtotal > MAX_MONTO_CENTAVOS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partidas"], message: `El subtotal (suma de cantidad × precio unitario) no puede exceder ${MAX_MONTO}` });
    return;
  }
  if (aCentavos(data.descuento) > subtotal) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["descuento"], message: "El descuento no puede ser mayor que el subtotal" });
  } else if (total > MAX_MONTO_CENTAVOS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["impuestos"], message: `El total no puede exceder ${MAX_MONTO}` });
  }
}

// Campos que se repiten al crear la v1 y al crear una nueva versión: la
// empresa y la oportunidad NO cambian entre versiones de la misma
// cotización (ver cotizacionRaizId en el schema), así que solo viven en
// crearCotizacionSchema, no aquí.
const datosCotizacionShape = z.object({
  contactoId: z.coerce.number().int().positive().optional(),
  descuento: z.coerce.number().min(0).max(MAX_MONTO).refine(tieneMaxDosDecimales, DOS_DECIMALES).default(0),
  impuestos: z.coerce.number().min(0).max(MAX_MONTO).refine(tieneMaxDosDecimales, DOS_DECIMALES).default(0),
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

// empresaId opcional desde la pantalla general de Cotizaciones: sin él se
// listan las de todas las empresas que la persona puede ver (un agente,
// las de sus oportunidades -- mismo scoping que con empresaId).
export const listCotizacionesQuerySchema = z.object({
  empresaId: z.coerce.number().int().positive().optional(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  estado: z.enum(["borrador", "enviada", "aceptada", "rechazada", "vencida"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});
export type ListCotizacionesQuery = z.infer<typeof listCotizacionesQuerySchema>;

export const cambiarEstadoCotizacionSchema = z.object({
  estado: z.enum(["enviada", "aceptada", "rechazada", "vencida"])
});
export type CambiarEstadoCotizacionInput = z.infer<typeof cambiarEstadoCotizacionSchema>;
