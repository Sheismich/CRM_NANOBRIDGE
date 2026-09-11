// Header Content-Disposition para una descarga adjunta, compartido entre
// LocalStorageController y GcsStorageDriver (hallazgo de code review,
// 11-sep-2026): antes cada uno construía el header a mano y ninguno lo
// hacía bien.
//
// - RFC 6266: un `filename` ASCII de respaldo (para el cliente que no
//   soporta `filename*`) más `filename*=UTF-8''<percent-encoded>` con el
//   nombre real. `encodeURIComponent()` dentro de un `filename=` plano NO
//   se decodifica en el navegador (esa forma no está en la RFC) -- por eso
//   "reporte final.pdf" se descargaba literalmente como
//   "reporte%20final.pdf".
// - El fallback ASCII reemplaza comillas/backslashes/no-ASCII por "_": un
//   nombre de archivo con una comilla (`foo".pdf`, entrada de multipart
//   perfectamente legal) rompía la cadena del header y permitía inyectar
//   atributos de Content-Disposition adicionales en la respuesta que GCS
//   sirve a cada descarga posterior.
export function contentDispositionAdjunto(nombreArchivo: string): string {
  const ascii = nombreArchivo.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const codificado = encodeURIComponent(nombreArchivo);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${codificado}`;
}
