import { z } from "zod";

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
  empresaSitioWeb: z.string().trim().url().max(2048).optional(),

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
  fuenteUrl: z.string().trim().url().max(2048).optional(),
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

export const filaCsvSchema = refinarProspecto(z.object({
  empresaNombreLegal: z.string().trim().min(2).max(255),
  empresaGiro: vacioComoUndefined(z.string().trim().max(120)),
  empresaTamano: vacioComoUndefined(z.enum(["micro", "pequena", "mediana", "grande"])),
  empresaRegion: vacioComoUndefined(z.string().trim().max(120)),
  empresaEstado: vacioComoUndefined(z.string().trim().max(120)),
  empresaCiudad: vacioComoUndefined(z.string().trim().max(120)),
  empresaPais: z.string().trim().length(2).default("MX"),
  empresaSitioWeb: vacioComoUndefined(z.string().trim().url().max(2048)),

  contactoNombre: z.string().trim().min(2).max(160),
  contactoPuesto: vacioComoUndefined(z.string().trim().max(160)),

  correo: vacioComoUndefined(z.string().trim().email().max(254)),
  telefono: vacioComoUndefined(z.string().trim().min(7).max(40)),
  canalInicial: z.enum(["correo", "telefono", "whatsapp"]),

  confianza: vacioComoUndefined(z.enum(["alta", "media", "baja"])),
  prioridad: vacioComoUndefined(z.enum(["alta", "media", "baja"])),
  score: vacioComoUndefined(z.coerce.number().min(0).max(100)),
  fuenteUrl: vacioComoUndefined(z.string().trim().url().max(2048)),
  observaciones: vacioComoUndefined(z.string().trim().max(2000)),
  campanaId: vacioComoUndefined(z.coerce.number().int().positive())
}));
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

export const listBorradoresQuerySchema = z.object({
  estado: z.enum(["pendiente_revision", "duplicado", "importado", "rechazado", "expirado"]).optional()
});
export type ListBorradoresQuery = z.infer<typeof listBorradoresQuerySchema>;
