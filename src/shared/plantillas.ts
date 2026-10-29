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

/** Lo que SendGrid cambia por la URL de baja (subscription_tracking.substitution_tag). */
export const ETIQUETA_BAJA = "[darte_de_baja]";
const PREGUNTA_BAJA = "¿Ya no quiere recibir estos correos?";

// El logo va en PNG (Gmail no muestra SVG) desde el front publicado.
const LOGO = "https://crm-prospeccion-outbound.web.app/logo-n.png";
const SITIO = "nanobridge-mex.com";
const FUENTE = "font-family:Arial,Helvetica,sans-serif";
const TABLA = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

export interface OpcionesCorreo {
  /** Quien firma (respuestas desde el CRM). Sin él, la firma dice solo NANOBRIDGE. */
  firma?: string;
  /**
   * Logo en la firma: solo en las respuestas desde el CRM (el cliente ya
   * contestó). En prospección no: con la imagen Gmail los mandaba a
   * Promociones (22-oct-2026).
   */
  logo?: boolean;
  /** Todo lo que va a un prospecto: "Darte de baja" al final del pie (ETIQUETA_BAJA). */
  linkDeBaja?: boolean;
  /** Lo que escribió el cliente, citado al final (respuestas desde el CRM). */
  cita?: { encabezado: string; contenido: string };
}

// Molde del 22-oct-2026 (opción A de docs/diseno/correo-diseno.html): se ve
// como el correo de una persona con firma cuidada, no como boletín. Solo
// tablas y estilos en línea, que es lo que Gmail y Outlook respetan.
function molde(partes: { cuerpo: string; firma?: string; logo: boolean; pie: string; linkDeBaja: boolean; cita?: OpcionesCorreo["cita"] }) {
  const nombre = partes.firma ? `<div style="font-size:15px;font-weight:bold;color:#1f2933">${escaparHtml(partes.firma)}</div>` : "";
  const firma =
    `<table ${TABLA}><tr>` +
    (partes.logo ? `<td style="padding:0 14px 0 0;vertical-align:middle"><img src="${LOGO}" width="44" height="44" alt="NANOBRIDGE" style="display:block;border:0"></td>` : "") +
    `<td style="border-left:2px solid #2a449b;padding:2px 0 2px 14px;vertical-align:middle;${FUENTE}">${nombre}` +
    `<div style="font-size:13px;color:#2a449b;letter-spacing:.5px">NANOBRIDGE</div>` +
    `<div style="font-size:12px"><a href="https://${SITIO}" style="color:#7b8794;text-decoration:none">${SITIO}</a></div>` +
    `</td></tr></table>`;
  const baja = partes.linkDeBaja ? `<p style="margin:10px 0 0">${PREGUNTA_BAJA} <a href="${ETIQUETA_BAJA}" style="color:#2a449b;font-weight:bold">Darte de baja</a></p>` : "";
  const pie = partes.pie || baja
    ? `<tr><td style="border-top:1px solid #e4e7eb;padding:14px 0 0;${FUENTE};font-size:11px;line-height:1.55;color:#7b8794">${partes.pie}${baja}</td></tr>`
    : "";
  const cita = partes.cita
    ? `<tr><td style="padding:18px 0 0;${FUENTE}"><p style="margin:0 0 6px;font-size:12px;color:#7b8794">${escaparHtml(partes.cita.encabezado)}</p>` +
      `<blockquote style="margin:0 0 0 4px;padding-left:12px;border-left:3px solid #d1d5db;color:#52606d;font-size:14px">${escaparHtml(partes.cita.contenido).replace(/\n/g, "<br>")}</blockquote></td></tr>`
    : "";
  return (
    `<table ${TABLA} width="100%" style="background:#ffffff"><tr><td style="padding:16px 24px">` +
    `<table ${TABLA} width="100%" style="max-width:600px">` +
    `<tr><td style="${FUENTE};font-size:15px;line-height:1.6;color:#1f2933">${partes.cuerpo}</td></tr>` +
    `<tr><td style="padding:6px 0 20px">${firma}</td></tr>` +
    pie +
    cita +
    `</table></td></tr></table>`
  );
}

/** El correo listo para mandar: asunto, texto plano y html. `pie` puede ir vacío. */
export function armarCorreo(plantilla: { asunto: string; cuerpo: string }, datos: DatosPlantilla, pie: string, opciones: OpcionesCorreo = {}): CorreoArmado {
  const v = valores(datos);
  const asunto = sustituir(plantilla.asunto, v).replace(/\s+/g, " ").trim();
  const texto = [
    textoDe(plantilla.cuerpo, v),
    opciones.firma ? `${opciones.firma}\nNANOBRIDGE` : "",
    textoDe(pie, v),
    opciones.linkDeBaja ? `${PREGUNTA_BAJA} Darte de baja: ${ETIQUETA_BAJA}` : "",
    opciones.cita ? `${opciones.cita.encabezado}\n${opciones.cita.contenido.split("\n").map((linea) => `> ${linea}`).join("\n")}` : ""
  ].filter(Boolean).join("\n\n");
  return {
    asunto,
    texto,
    html: molde({ cuerpo: htmlDe(plantilla.cuerpo, v), firma: opciones.firma, logo: Boolean(opciones.logo), pie: htmlDe(pie, v, "margin:0 0 8px"), linkDeBaja: Boolean(opciones.linkDeBaja), cita: opciones.cita })
  };
}
