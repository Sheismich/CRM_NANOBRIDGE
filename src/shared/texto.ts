/**
 * Recorta un texto a `max` caracteres completos. String.slice cuenta
 * unidades UTF-16, así que un emoji (dos unidades) justo en el límite
 * quedaba partido y la base guardaba un carácter roto; Array.from separa
 * por code points, que es también lo que cuenta un VARCHAR(n) de MySQL en
 * utf8mb4.
 */
export function recortarTexto(texto: string, max: number): string {
  const caracteres = Array.from(texto);
  return caracteres.length <= max ? texto : caracteres.slice(0, max).join("");
}

/**
 * Cambia correos y teléfonos por [correo] y [teléfono] en un texto que va a
 * la IA (P4.3): la firma de un correo del cliente o un comentario del
 * vendedor los traen, y la IA no los necesita. Lo usan el resumen de la ficha
 * y el borrador de respuesta.
 */
export function sinDatosDeContacto(texto: string): string {
  return texto
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[correo]")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (coincidencia) => (coincidencia.replace(/\D/g, "").length >= 7 ? "[teléfono]" : coincidencia));
}

const utf8Estricto = new TextDecoder("utf-8", { fatal: true });

/** true si los bytes son UTF-8 válido (sin ningún byte que se volvería "�"). */
export function esUtf8Valido(bytes: Uint8Array): boolean {
  try {
    utf8Estricto.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Lee un archivo de texto subido por una persona (CSV de importación). Si es
 * UTF-8 válido se lee así; si no, como Windows-1252, que es lo que guarda
 * Excel en español con "CSV (delimitado por comas)". Antes todo se leía como
 * UTF-8 y "Peña" entraba como "Pe�a" (7-oct-2026). Windows-1252 cubre las
 * letras del español y nunca falla, así que no hace falta adivinar más.
 */
export function decodificarArchivoTexto(bytes: Uint8Array): string {
  return esUtf8Valido(bytes) ? utf8Estricto.decode(bytes) : new TextDecoder("windows-1252").decode(bytes);
}
