import { z } from "zod";
import { httpUrlSchema } from "../../shared/http-url.js";

// Campos comunes a una fila de prospecto, vengan de un alta manual
// (prospectoInputSchema, un solo registro) o de una fila de CSV
// (filaCsvSchema, aplicado a cada fila ya parseada por parseCsv). El
// mismo shape evita que ambos caminos de "Alta manual e importación CSV"
// (PLAN_CRM_DEFINITIVO.md #3) diverjan en qué validan.
const camposProspecto = {
  empresaNombreLegal: z.string().trim().min(2).max(255),
  empresaGiro: z.string().trim().max(120).optional(),
  empresaTamano: z.enum(["micro", "pequena", "mediana", "grande"]).optional(),
  empresaRegion: z.string().trim().max(120).optional(),
  empresaEstado: z.string().trim().max(120).optional(),
  empresaCiudad: z.string().trim().max(120).optional(),
  empresaPais: z.string().length(2).default("MX"),
  empresaSitioWeb: httpUrlSchema.optional(),

  contactoNombre: z.string().trim().min(2).max(160),
  contactoPuesto: z.string().trim().max(160).optional(),

  correo: z.string().trim().email().max(254).optional(),
  telefono: z.string().trim().min(7).max(40).optional(),
  // "Validación de... canal" (PLAN_CRM_DEFINITIVO.md #3): el canal
  // inicial declarado debe corresponder a un medio que sí viene en la
  // fila -- lo exige el .refine de abajo, no basta con que el enum sea
  // válido.
  canalInicial: z.enum(["correo", "telefono", "whatsapp"]),

  confianza: z.enum(["alta", "media", "baja"]).optional(),
  prioridad: z.enum(["alta", "media", "baja"]).optional(),
  score: z.coerce.number().min(0).max(100).optional(),
  fuenteUrl: httpUrlSchema.optional(),
  observaciones: z.string().trim().max(2000).optional(),
  campanaId: z.coerce.number().int().positive().optional()
};

function refinarProspecto<T extends z.ZodTypeAny>(schema: T) {
  return schema
    .refine((input: any) => input.correo || input.telefono, { message: "El prospecto requiere correo o teléfono para poder deduplicar" })
    .refine((input: any) => (input.canalInicial !== "correo" || input.correo) && (input.canalInicial !== "telefono" || input.telefono) && (input.canalInicial !== "whatsapp" || input.telefono), {
      message: "El canal inicial declarado no tiene un medio de contacto correspondiente en la fila"
    });
}

// Alta manual de un solo prospecto (POST /api/v1/prospectos).
export const prospectoInputSchema = refinarProspecto(z.object(camposProspecto));
export type ProspectoInput = z.infer<typeof prospectoInputSchema>;

// Una fila de CSV ya parseada por parseCsv() llega como
// Record<string, string> (todo texto, sin coerción de tipos de multer/
// csv) -- z.coerce en score/campanaId y los .optional() sobre string
// vacío (una celda vacía de Excel se vuelve "" al exportar CSV, no
// undefined) son la diferencia principal contra prospectoInputSchema.
const vacioComoUndefined = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

// Los catálogos del CSV los escribe una persona en Excel: "MICRO",
// "Pequeña" o "Teléfono" deben valer igual que "micro", "pequena" o
// "telefono". El mensaje va en español y dice qué valores se aceptan,
// porque se muestra tal cual en la revisión fila por fila.
const catalogoCsv = <const T extends readonly [string, ...string[]]>(valores: T) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "") : v),
    z.enum(valores, { error: `Valor no válido; usa ${valores.slice(0, -1).join(", ")} o ${valores.at(-1)}` })
  );

const camposFilaCsv = z.object({
  empresaNombreLegal: z.string({ error: "Falta el nombre de la empresa" }).trim().min(2, "Mínimo 2 caracteres").max(255, "Máximo 255 caracteres"),
  empresaGiro: vacioComoUndefined(z.string().trim().max(120)),
  empresaTamano: vacioComoUndefined(catalogoCsv(["micro", "pequena", "mediana", "grande"])),
  empresaRegion: vacioComoUndefined(z.string().trim().max(120)),
  empresaEstado: vacioComoUndefined(z.string().trim().max(120)),
  empresaCiudad: vacioComoUndefined(z.string().trim().max(120)),
  empresaPais: z.string().trim().length(2, "Usa la clave de 2 letras del país (ej. MX)").default("MX"),
  empresaSitioWeb: vacioComoUndefined(httpUrlSchema),

  contactoNombre: z.string({ error: "Falta el nombre del contacto" }).trim().min(2, "Mínimo 2 caracteres").max(160, "Máximo 160 caracteres"),
  contactoPuesto: vacioComoUndefined(z.string().trim().max(160)),

  correo: vacioComoUndefined(z.string().trim().email("Correo no válido").max(254, "Máximo 254 caracteres")),
  telefono: vacioComoUndefined(z.string().trim().min(7, "Teléfono demasiado corto").max(40, "Máximo 40 caracteres")),
  canalInicial: catalogoCsv(["correo", "telefono", "whatsapp"]),

  confianza: vacioComoUndefined(catalogoCsv(["alta", "media", "baja"])),
  prioridad: vacioComoUndefined(catalogoCsv(["alta", "media", "baja"])),
  score: vacioComoUndefined(z.coerce.number({ error: "Debe ser un número" }).min(0, "Mínimo 0").max(100, "Máximo 100")),
  fuenteUrl: vacioComoUndefined(httpUrlSchema),
  observaciones: vacioComoUndefined(z.string().trim().max(2000)),
  campanaId: vacioComoUndefined(z.coerce.number({ error: "Debe ser un número" }).int("Debe ser un número entero").positive("Debe ser un número positivo"))
});
export const filaCsvSchema = refinarProspecto(camposFilaCsv);
// Las columnas que acepta el CSV, sacadas del mismo esquema que valida cada
// fila: así no hay una segunda lista que mantener a mano.
export const COLUMNAS_CSV: readonly string[] = Object.keys(camposFilaCsv.shape);
export type FilaCsv = z.infer<typeof filaCsvSchema>;

export const importarCsvBodySchema = z.object({
  campanaId: z.coerce.number().int().positive().optional()
});
export type ImportarCsvBody = z.infer<typeof importarCsvBodySchema>;

export const listProspectosQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  estado: z.string().trim().max(60).optional(),
  prioridad: z.enum(["alta", "media", "baja"]).optional(),
  q: z.string().trim().max(255).optional()
});
export type ListProspectosQuery = z.infer<typeof listProspectosQuerySchema>;

export const listLotesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20)
});
export type ListLotesQuery = z.infer<typeof listLotesQuerySchema>;

export const listBorradoresQuerySchema = z.object({
  estado: z.enum(["pendiente_revision", "duplicado", "importado", "rechazado", "expirado"]).optional()
});
export type ListBorradoresQuery = z.infer<typeof listBorradoresQuerySchema>;
