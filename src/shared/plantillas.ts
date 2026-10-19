// Armado de los correos de prospección a partir de una plantilla (etapa 1 de
// las mejoras, 19-oct-2026). Función pura: la usan POST /automatizacion/envios
// (el correo que manda n8n) y la vista previa de Administración, así las dos
// dicen exactamente lo mismo.
//
// Formato: texto con párrafos. Una línea en blanco separa párrafos (un <p>
// cada uno, igual que armaba PT1b) y un salto de línea dentro del párrafo es
// un <br>. Encima, formato básico con marcas (barra del editor):
// **negrita**, *cursiva* y [texto](https://…). Las marcas se aplican a la
// PLANTILLA antes de meter los datos del prospecto, así un nombre con
// asteriscos o corchetes no cambia el formato. El asunto no lleva formato.

export const VARIABLES_PLANTILLA = [
  { clave: "nombre", descripcion: "Nombre completo del contacto" },
  { clave: "primer_nombre", descripcion: "Solo el primer nombre del contacto" },
  { clave: "empresa", descripcion: "Nombre de la empresa" },
  { clave: "giro", descripcion: "Giro de la empresa" }
] as const;

export type VariablePlantilla = (typeof VARIABLES_PLANTILLA)[number]["clave"];

/** Los datos de la persona; nombre, empresa y giro (primer_nombre sale de nombre). */
export type DatosPlantilla = Partial<Record<"nombre" | "empresa" | "giro", string | null>>;

export interface CorreoArmado {
  asunto: string;
  texto: string;
  html: string;
}

const CLAVES = new Set<string>(VARIABLES_PLANTILLA.map((v) => v.clave));
const VARIABLE = /( ?)\{\{\s*([A-Za-z_]+)\s*\}\}/g;
// Una dirección sin espacios, paréntesis, llaves ni < >: así una {{variable}}
// dentro de la dirección no cuenta como enlace (se rechaza al guardar).
const URL_VALIDA = /^https?:\/\/[^\s(){}<>"]+$/;
const ENLACE = /\[([^\]\n]+)\]\(([^)\n]*)\)/g;
const NEGRITA = /\*\*(?=\S)(.+?)(?<=\S)\*\*/g;
const CURSIVA = /\*(?=\S)(.+?)(?<=\S)\*/g;

/** Las {{variables}} del texto que no existen (en el orden en que aparecen, sin repetir). */
export function variablesDesconocidas(texto: string): string[] {
  const desconocidas: string[] = [];
  for (const [, , nombre] of texto.matchAll(VARIABLE)) {
    if (!CLAVES.has(nombre!) && !desconocidas.includes(nombre!)) desconocidas.push(nombre!);
  }
  return desconocidas;
}

/** El texto de los [enlaces](…) cuya dirección no empieza con http:// o https:// (o no es válida). */
export function enlacesInvalidos(texto: string): string[] {
  return [...texto.matchAll(ENLACE)].filter(([, , url]) => !URL_VALIDA.test(url!)).map(([, etiqueta]) => etiqueta!);
}

function valores(datos: DatosPlantilla): Record<VariablePlantilla, string> {
  const nombre = (datos.nombre ?? "").trim();
  return {
    nombre,
    primer_nombre: nombre.split(/\s+/)[0] ?? "",
    empresa: (datos.empresa ?? "").trim(),
    giro: (datos.giro ?? "").trim()
  };
}

// Un dato vacío se quita con todo y el espacio de antes: "Hola {{primer_nombre}},"
// sin nombre queda "Hola,". Una variable desconocida (no debería llegar: se
// rechaza al guardar) se deja tal cual. `transformar` escapa el valor en html.
function sustituir(texto: string, v: Record<VariablePlantilla, string>, transformar: (s: string) => string = (s) => s) {
  return texto.replace(VARIABLE, (completo, espacio: string, nombre: string) => {
    if (!CLAVES.has(nombre)) return completo;
    const valor = v[nombre as VariablePlantilla];
    return valor ? `${espacio}${transformar(valor)}` : "";
  });
}

function escaparHtml(texto: string) {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Sobre una línea YA escapada: la dirección también va escapada (&amp;), que
// es como debe ir dentro de href.
function formatoHtml(linea: string) {
  return linea
    .replace(ENLACE, (completo, etiqueta: string, url: string) => (URL_VALIDA.test(url) ? `<a href="${url}">${etiqueta}</a>` : completo))
    .replace(NEGRITA, "<strong>$1</strong>")
    .replace(CURSIVA, "<em>$1</em>");
}

// Versión de solo texto: sin marcas; el enlace como "texto (dirección)".
function formatoTexto(texto: string) {
  return texto
    .replace(ENLACE, (completo, etiqueta: string, url: string) => (URL_VALIDA.test(url) ? (etiqueta === url ? url : `${etiqueta} (${url})`) : completo))
    .replace(NEGRITA, "$1")
    .replace(CURSIVA, "$1");
}

function normalizar(texto: string) {
  return texto.replace(/\r\n?/g, "\n").trim();
}

function parrafos(texto: string) {
  return texto.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
}

function htmlDe(plantilla: string, v: Record<VariablePlantilla, string>, estilo?: string) {
  return parrafos(normalizar(plantilla))
    .map((p) => p.split("\n").map((linea) => sustituir(formatoHtml(escaparHtml(linea)), v, escaparHtml).trim()).filter(Boolean).join("<br>"))
    .filter(Boolean)
    .map((contenido) => (estilo ? `<p style="${estilo}">${contenido}</p>` : `<p>${contenido}</p>`))
    .join("");
}

function textoDe(plantilla: string, v: Record<VariablePlantilla, string>) {
  return normalizar(sustituir(formatoTexto(normalizar(plantilla)), v));
}

/** El correo listo para mandar: asunto, texto plano y html. `pie` puede ir vacío. */
export function armarCorreo(plantilla: { asunto: string; cuerpo: string }, datos: DatosPlantilla, pie: string): CorreoArmado {
  const v = valores(datos);
  const asunto = sustituir(plantilla.asunto, v).replace(/\s+/g, " ").trim();
  const cuerpo = textoDe(plantilla.cuerpo, v);
  const pieTexto = textoDe(pie, v);
  return {
    asunto,
    texto: pieTexto ? `${cuerpo}\n\n${pieTexto}` : cuerpo,
    html: htmlDe(plantilla.cuerpo, v) + htmlDe(pie, v, "color:#6b7280;font-size:12px")
  };
}
