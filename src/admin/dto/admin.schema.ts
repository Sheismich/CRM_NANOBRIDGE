import { z } from "zod";
import { TIPOS_REGISTRO } from "../registro-cambios.catalogo.js";

export const problemasQuerySchema = z.object({
  estado: z.enum(["abierto", "en_revision", "resuelto"]).optional()
});

export const claveProblemaSchema = z.object({
  clave: z.string().trim().min(1).max(80)
});

// Registro de cambios (12-oct-2026). desde/hasta = días de México.
const filtrosRegistro = z.object({
  tipo: z.enum(["todo", ...TIPOS_REGISTRO]).default("todo"),
  usuarioId: z.coerce.number().int().positive().optional(),
  entidad: z.string().trim().min(1).max(80).optional(),
  entidadId: z.coerce.number().int().positive().optional(),
  q: z.string().trim().min(1).max(120).optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional()
});
const rangoValido = (f: { desde?: string; hasta?: string }) => !f.desde || !f.hasta || f.desde <= f.hasta;
const ERROR_RANGO = { message: "desde no puede ser después de hasta", path: ["desde"] };

export const registroCambiosQuerySchema = filtrosRegistro.extend({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).refine(rangoValido, ERROR_RANGO);
export type RegistroCambiosQuery = z.infer<typeof registroCambiosQuerySchema>;

export const registroCambiosExportQuerySchema = filtrosRegistro.extend({
  formato: z.enum(["pdf", "csv"]).default("pdf")
}).refine(rangoValido, ERROR_RANGO);
export type RegistroCambiosExportQuery = z.infer<typeof registroCambiosExportQuerySchema>;
