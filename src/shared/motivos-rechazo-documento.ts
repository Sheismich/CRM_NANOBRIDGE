// Por qué se rechaza un documento (029_documentos_revision_y_expediente.sql),
// en un solo lugar: de aquí salen el ENUM de Drizzle (schema.ts), el z.enum
// del endpoint, la lista que pide el front (GET /documentos/catalogos) y el
// texto de la tarea "Corregir documento". El SQL de la migración va escrito a
// mano; 410-documentos-revision-expediente.spec.ts compara el ENUM real de la
// base contra esta constante.
//
// Sin imports a propósito, igual que clasificaciones.ts: schema.ts lo importa.
// Los valores nuevos van al final (es el orden del ENUM en la base).
export const CLAVES_MOTIVO_RECHAZO_DOCUMENTO = ["ilegible", "vencido", "incompleto", "no_es_de_la_empresa", "tipo_equivocado", "otro"] as const;
export type MotivoRechazoDocumento = (typeof CLAVES_MOTIVO_RECHAZO_DOCUMENTO)[number];

// Record: si se agrega una clave arriba sin su nombre, no compila.
export const NOMBRE_MOTIVO_RECHAZO_DOCUMENTO: Record<MotivoRechazoDocumento, string> = {
  ilegible: "Ilegible o borroso",
  vencido: "Vencido",
  incompleto: "Incompleto (faltan páginas)",
  no_es_de_la_empresa: "No es de esta empresa",
  tipo_equivocado: "Tipo equivocado",
  otro: "Otro"
};

export const MOTIVOS_RECHAZO_DOCUMENTO = CLAVES_MOTIVO_RECHAZO_DOCUMENTO.map((clave) => ({ clave, nombre: NOMBRE_MOTIVO_RECHAZO_DOCUMENTO[clave] }));
