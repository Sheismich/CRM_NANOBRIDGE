import type { TIPOS_MIME_PERMITIDOS } from "./dto/documento.schema.js";

type TipoPermitido = (typeof TIPOS_MIME_PERMITIDOS)[number];

// El tipo que declara el navegador lo escribe quien sube el archivo: un HTML
// o un .exe declarado "application/pdf" se guardaba igual (C5 del plan de
// fixes, 2-oct-2026). Aquí se revisa por los primeros bytes ("magic
// bytes"). DOCX y XLSX son ZIP; se distinguen por las carpetas de adentro
// ("word/" o "xl/"), cuyos nombres van en texto plano dentro del ZIP.
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const FIRMAS: Record<TipoPermitido, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": (b) => b.subarray(0, 4).equals(ZIP) && b.includes("word/"),
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": (b) => b.subarray(0, 4).equals(ZIP) && b.includes("xl/")
};

export function contenidoEsDelTipo(mimeType: TipoPermitido, contenido: Buffer): boolean {
  return FIRMAS[mimeType](contenido);
}

// Extensiones que valen para cada tipo en el nombre de descarga; la primera
// es la que se agrega si falta.
const EXTENSIONES: Record<TipoPermitido, readonly string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]
};

// Nombre con el que se descarga: el original, pero terminado en la
// extensión del tipo ya validado. "factura.exe" subido como PDF se baja
// como "factura.exe.pdf" y el sistema operativo lo abre como PDF.
export function nombreDeDescarga(nombreOriginal: string, mimeType: string): string {
  const extensiones = EXTENSIONES[mimeType as TipoPermitido];
  if (!extensiones) return nombreOriginal;
  const minusculas = nombreOriginal.toLowerCase();
  return extensiones.some((ext) => minusculas.endsWith(ext)) ? nombreOriginal : `${nombreOriginal}${extensiones[0]}`;
}
