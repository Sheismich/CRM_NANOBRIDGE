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
