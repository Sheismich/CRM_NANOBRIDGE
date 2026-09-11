import { z } from "zod";

// "Tipos permitidos: PDF, DOCX, XLSX, PNG y JPG" (PLAN_CRM_DEFINITIVO.md
// #8). Se valida el mime type declarado por el cliente (multipart), igual
// nivel de confianza que el resto de la validación de entrada del proyecto
// (Zod sobre lo que manda el request) -- no hay inspección de bytes/magic
// number en este alcance.
export const TIPOS_MIME_PERMITIDOS = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "image/png",
  "image/jpeg" // .jpg / .jpeg
] as const;

// Campos de multipart/form-data llegan como texto plano en req.body -- por
// eso z.coerce en los ids, igual patrón que el resto de los controllers.
export const subirDocumentoSchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  contactoId: z.coerce.number().int().positive().optional(),
  // Texto libre a propósito: "La política de retención será configurable y
  // aprobada por la empresa" (PLAN_CRM_DEFINITIVO.md #8) -- no hay un
  // catálogo cerrado que este alcance deba inventar.
  politicaRetencion: z.string().trim().min(1).max(60).optional()
});
export type SubirDocumentoInput = z.infer<typeof subirDocumentoSchema>;

export const nuevaVersionDocumentoSchema = z.object({
  politicaRetencion: z.string().trim().min(1).max(60).optional()
});
export type NuevaVersionDocumentoInput = z.infer<typeof nuevaVersionDocumentoSchema>;

export const listDocumentosQuerySchema = z.object({
  empresaId: z.coerce.number().int().positive(),
  oportunidadId: z.coerce.number().int().positive().optional(),
  contactoId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});
export type ListDocumentosQuery = z.infer<typeof listDocumentosQuerySchema>;

// Estados (el plan no detalla el criterio, se define aquí -- ver comentario
// de estado en 014_documentos.sql): 'obsoleto' nunca es destino de un
// cambio de estado manual, solo lo fija POST .../version, mismo criterio
// que cotizaciones.
export const cambiarEstadoDocumentoSchema = z.object({
  estado: z.enum(["vigente", "archivado"])
});
export type CambiarEstadoDocumentoInput = z.infer<typeof cambiarEstadoDocumentoSchema>;

// "revisión" (el plan no lo detalla -- ver comentario en
// DocumentosService.revisar): confirmación explícita de que alguien del
// equipo revisó el documento, no una simple lectura de metadatos.
export const revisarDocumentoSchema = z.object({
  comentario: z.string().trim().max(500).optional()
});
export type RevisarDocumentoInput = z.infer<typeof revisarDocumentoSchema>;
