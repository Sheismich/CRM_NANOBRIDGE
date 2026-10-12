import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import SVGtoPDF from "svg-to-pdfkit";

// Molde común de los PDF del CRM (bloque 6, 12-oct-2026): hoja carta con el
// logo y el título arriba, la N de marca de agua atrás de cada hoja y el pie
// "NANOBRIDGE · CRM ... página N de M". Lo usan el informe ejecutivo, la
// cotización y (bloque 7) el Registro de cambios. Las medidas salen de
// docs/diseno/informe-ejecutivo.html: allá la hoja mide 816 px de ancho y
// aquí 612 pt, así que todo va multiplicado por 0.75.
//
// pdfkit es JavaScript puro: no necesita Chromium ni librerías del sistema,
// así que corre igual en la imagen node:22-bookworm-slim de Cloud Run.

const RECURSOS = fileURLToPath(new URL("./recursos/", import.meta.url));
const LOGO_N = readFileSync(`${RECURSOS}n-color.svg`, "utf8");

export const FUENTE = {
  normal: "Manrope",
  semi: "Manrope-SemiBold",
  negrita: "Manrope-Bold",
  extra: "Manrope-ExtraBold",
  numeros: "Anton",
  marca: "Montserrat-ExtraBold"
} as const;

const ARCHIVOS_FUENTE: Record<(typeof FUENTE)[keyof typeof FUENTE], string> = {
  "Manrope": "Manrope-Regular.ttf",
  "Manrope-SemiBold": "Manrope-SemiBold.ttf",
  "Manrope-Bold": "Manrope-Bold.ttf",
  "Manrope-ExtraBold": "Manrope-ExtraBold.ttf",
  "Anton": "Anton-Regular.ttf",
  "Montserrat-ExtraBold": "Montserrat-ExtraBold.ttf"
};

export const COLOR = {
  tinta: "#101733",
  texto: "#151c36",
  textoSuave: "#3b4466",
  gris: "#5b6482",
  etiqueta: "#6f7aa3",
  pie: "#8992ad",
  borde: "#e3e8f2",
  bordeSuave: "#eef1f7",
  azul: "#2a449b",
  morado: "#5b2d86",
  cian: "#23bad3",
  lavanda: "#cdd3ea",
  verde: "#158a5c",
  rojo: "#d63a4a",
  ambar: "#c47a0a"
} as const;

export const MARGEN = { arriba: 36, lados: 39, abajo: 52 };

// Espacio entre letras de títulos y etiquetas en mayúsculas. Más chico que
// en el diseño a propósito: arriba de ~1/10 del tamaño de la letra, los
// lectores de PDF lo toman como espacios y "CONCEPTO" se copia o se busca
// como "C O N C E P T O".
const ESPACIADO_MARCA = 0.75;
const ESPACIADO_TITULOS = 0.75;
const ESPACIADO_ETIQUETAS = 0.6;
const ALTO_PIE = 30;

export type DocumentoPdf = PDFKit.PDFDocument;

export interface OpcionesHoja {
  titulo: string;
  /** Renglones chicos debajo del título, a la derecha (periodo, quién lo generó...). */
  lineas: string[];
  /** Texto del pie antes de "página N de M" (p. ej. "Datos al 12 oct 2026"). */
  notaPie?: string;
}

const pedazos = new WeakMap<DocumentoPdf, Buffer[]>();
const notasPie = new WeakMap<DocumentoPdf, string | undefined>();

/** Hoja carta nueva con el encabezado ya dibujado; doc.y queda debajo de él. */
export function crearDocumentoCarta(opciones: OpcionesHoja): DocumentoPdf {
  const doc = new PDFDocument({
    size: "LETTER",
    autoFirstPage: false,
    bufferPages: true,
    margins: { top: MARGEN.arriba, bottom: MARGEN.abajo, left: MARGEN.lados, right: MARGEN.lados },
    info: { Title: opciones.titulo, Author: "NANOBRIDGE CRM", Creator: "NANOBRIDGE CRM" }
  });
  const recibido: Buffer[] = [];
  doc.on("data", (pedazo: Buffer) => recibido.push(pedazo));
  pedazos.set(doc, recibido);
  notasPie.set(doc, opciones.notaPie);
  for (const [nombre, archivo] of Object.entries(ARCHIVOS_FUENTE)) {
    doc.registerFont(nombre, `${RECURSOS}fuentes/${archivo}`);
  }
  // La marca de agua va en cada hoja nueva, antes de cualquier contenido,
  // para que quede atrás. Las hojas que abre una tabla larga también la
  // llevan.
  doc.on("pageAdded", () => {
    marcaDeAgua(doc);
    doc.x = MARGEN.lados;
    doc.y = MARGEN.arriba;
  });
  doc.addPage();
  encabezado(doc, opciones);
  return doc;
}

// N grande al centro con 6% de opacidad. svg-to-pdfkit pone su propia
// opacidad a cada figura del SVG, así que en vez de bajarle la opacidad al
// logo se dibuja completo y se tapa con blanco al 94%: queda igual.
function marcaDeAgua(doc: DocumentoPdf) {
  const ancho = 480;
  const x = (doc.page.width - ancho) / 2;
  const y = doc.page.height * 0.52 - ancho / 2;
  doc.save();
  SVGtoPDF(doc, LOGO_N, x, y, { width: ancho, height: ancho, preserveAspectRatio: "xMidYMid meet" });
  doc.restore();
  doc.save();
  doc.rect(x - 2, y - 2, ancho + 4, ancho + 4).fillOpacity(0.94).fill("#ffffff");
  doc.restore();
}

function encabezado(doc: DocumentoPdf, opciones: OpcionesHoja) {
  const izquierda = MARGEN.lados;
  const derecha = doc.page.width - MARGEN.lados;
  const ancho = derecha - izquierda;
  const arriba = MARGEN.arriba;

  SVGtoPDF(doc, LOGO_N, izquierda, arriba, { width: 33, height: 33, preserveAspectRatio: "xMidYMid meet" });
  doc.font(FUENTE.marca).fontSize(16.5).fillColor(COLOR.tinta)
    .text("NANOBRIDGE", izquierda + 40, arriba + 8, { characterSpacing: ESPACIADO_MARCA, lineBreak: false });

  doc.font(FUENTE.marca).fontSize(15).fillColor(COLOR.tinta)
    .text(opciones.titulo, izquierda, arriba - 2, { width: ancho, align: "right" });
  doc.font(FUENTE.normal).fontSize(9).fillColor(COLOR.gris);
  for (const linea of opciones.lineas) {
    doc.text(linea, izquierda, doc.y + 1, { width: ancho, align: "right" });
  }

  const linea = Math.max(arriba + 46, doc.y + 8);
  const degradado = doc.linearGradient(izquierda, 0, derecha, 0)
    .stop(0, COLOR.azul).stop(0.5, COLOR.morado).stop(1, COLOR.cian);
  doc.rect(izquierda, linea, ancho, 2.25).fill(degradado);
  doc.x = izquierda;
  doc.y = linea + 2.25;
}

export function anchoUtil(doc: DocumentoPdf): number {
  return doc.page.width - MARGEN.lados * 2;
}

export function limiteInferior(doc: DocumentoPdf): number {
  return doc.page.height - MARGEN.abajo;
}

/** Abre otra hoja si lo que sigue (de `alto` puntos) ya no cabe en esta. */
export function asegurarEspacio(doc: DocumentoPdf, alto: number) {
  if (doc.y + alto > limiteInferior(doc)) doc.addPage();
}

/** Título de sección: "RESUMEN DEL MES" en azul, con espacio entre letras. */
export function seccion(doc: DocumentoPdf, titulo: string, opciones: { x?: number; ancho?: number; arriba?: number } = {}) {
  asegurarEspacio(doc, 60);
  const x = opciones.x ?? MARGEN.lados;
  doc.y += opciones.arriba ?? 19.5;
  doc.font(FUENTE.marca).fontSize(8.25).fillColor(COLOR.azul)
    .text(titulo.toUpperCase(), x, doc.y, { width: opciones.ancho ?? anchoUtil(doc), characterSpacing: ESPACIADO_TITULOS });
  doc.y += 9;
}

export interface TarjetaDato {
  etiqueta: string;
  valor: string;
  nota?: string;
  colorNota?: string;
  /** Flechita antes de la nota: arriba (verde) o abajo (rojo). */
  flecha?: "arriba" | "abajo";
}

/** Fila de tarjetas iguales ("PIPELINE ABIERTO $1.28M ▲ 18% vs sep"). */
export function tarjetas(doc: DocumentoPdf, datos: TarjetaDato[]) {
  const separacion = 9;
  const alto = 87;
  asegurarEspacio(doc, alto);
  const ancho = (anchoUtil(doc) - separacion * (datos.length - 1)) / datos.length;
  const y = doc.y;
  datos.forEach((dato, i) => {
    const x = MARGEN.lados + i * (ancho + separacion);
    doc.save();
    doc.roundedRect(x, y, ancho, alto, 9).fillOpacity(0.85).fill("#ffffff");
    doc.restore();
    doc.roundedRect(x, y, ancho, alto, 9).lineWidth(0.75).stroke(COLOR.borde);
    doc.font(FUENTE.extra).fontSize(7).fillColor(COLOR.etiqueta)
      .text(dato.etiqueta.toUpperCase(), x + 10.5, y + 12, { width: ancho - 21, characterSpacing: ESPACIADO_ETIQUETAS, lineBreak: false });
    doc.font(FUENTE.numeros).fontSize(21).fillColor(COLOR.tinta)
      .text(dato.valor, x + 10.5, y + 27, { width: ancho - 21, lineBreak: false });
    if (dato.nota) {
      let xNota = x + 10.5;
      const yNota = y + 66;
      const color = dato.colorNota ?? (dato.flecha === "abajo" ? COLOR.rojo : dato.flecha === "arriba" ? COLOR.verde : COLOR.gris);
      if (dato.flecha) {
        triangulo(doc, xNota, yNota + 1.5, dato.flecha, color);
        xNota += 9;
      }
      doc.font(FUENTE.negrita).fontSize(8.25).fillColor(color)
        .text(dato.nota, xNota, yNota, { width: ancho - 21 - (xNota - x - 10.5), lineBreak: false });
    }
  });
  doc.x = MARGEN.lados;
  doc.y = y + alto;
}

// Las fuentes no traen "▲"/"▼": se dibujan como figura.
export function triangulo(doc: DocumentoPdf, x: number, y: number, sentido: "arriba" | "abajo", color: string) {
  const lado = 6;
  const alto = 5.5;
  if (sentido === "arriba") doc.polygon([x, y + alto], [x + lado, y + alto], [x + lado / 2, y]);
  else doc.polygon([x, y], [x + lado, y], [x + lado / 2, y + alto]);
  doc.fill(color);
}

export interface ColumnaTabla {
  titulo: string;
  /** Proporción del ancho de la tabla (se reparte entre la suma de todas). */
  ancho: number;
  alinear?: "left" | "right" | "center";
}

export type CeldaTabla = string | number | null | undefined | {
  texto: string;
  /** Segunda línea chica y gris (p. ej. el detalle de una partida). */
  secundario?: string | null;
  color?: string;
  negrita?: boolean;
};

export interface OpcionesTabla {
  columnas: ColumnaTabla[];
  filas: CeldaTabla[][];
  /** Texto si no hay renglones. */
  vacio?: string;
}

const RELLENO_X = 4.5;
const RELLENO_Y = 6.75;
const TAMANO_CELDA = 9;
const TAMANO_SECUNDARIO = 7.5;
const ALTO_ENCABEZADO = 19;

/**
 * Tabla que aguanta listas largas: si un renglón ya no cabe, abre otra hoja
 * y repite el encabezado arriba. Cada renglón mide lo que mida su celda más
 * alta (los textos largos bajan de renglón dentro de su columna).
 * Un renglón no se parte entre dos hojas: si un texto puede ser más largo
 * que una hoja entera (p. ej. un "antes → después" del Registro de cambios),
 * hay que recortarlo antes de pasarlo aquí.
 */
export function tabla(doc: DocumentoPdf, opciones: OpcionesTabla) {
  const x0 = MARGEN.lados;
  const total = opciones.columnas.reduce((suma, c) => suma + c.ancho, 0);
  const anchos = opciones.columnas.map((c) => (c.ancho / total) * anchoUtil(doc));
  const posiciones = anchos.map((_, i) => x0 + anchos.slice(0, i).reduce((s, a) => s + a, 0));

  const dibujarEncabezado = () => {
    const y = doc.y;
    doc.font(FUENTE.extra).fontSize(7).fillColor(COLOR.etiqueta);
    opciones.columnas.forEach((columna, i) => {
      doc.text(columna.titulo.toUpperCase(), posiciones[i]! + RELLENO_X, y + 6, {
        width: anchos[i]! - RELLENO_X * 2, align: columna.alinear ?? "left", characterSpacing: ESPACIADO_ETIQUETAS, lineBreak: false
      });
    });
    linea(doc, x0, y + ALTO_ENCABEZADO, anchoUtil(doc), COLOR.borde);
    doc.y = y + ALTO_ENCABEZADO;
  };

  const primera = opciones.filas[0];
  asegurarEspacio(doc, ALTO_ENCABEZADO + (primera ? altoFila(doc, primera, anchos) : 24));
  dibujarEncabezado();

  if (opciones.filas.length === 0 && opciones.vacio) {
    doc.font(FUENTE.normal).fontSize(TAMANO_CELDA).fillColor(COLOR.gris)
      .text(opciones.vacio, x0 + RELLENO_X, doc.y + RELLENO_Y, { width: anchoUtil(doc) - RELLENO_X * 2 });
    doc.y += RELLENO_Y;
  }

  for (const fila of opciones.filas) {
    const alto = altoFila(doc, fila, anchos);
    if (doc.y + alto > limiteInferior(doc)) {
      doc.addPage();
      dibujarEncabezado();
    }
    const y = doc.y;
    fila.forEach((celda, i) => {
      const { texto, secundario, color, negrita } = normalizar(celda);
      const ancho = anchos[i]! - RELLENO_X * 2;
      const alinear = opciones.columnas[i]?.alinear ?? "left";
      doc.font(negrita ? FUENTE.negrita : FUENTE.normal).fontSize(TAMANO_CELDA).fillColor(color ?? COLOR.texto)
        .text(texto, posiciones[i]! + RELLENO_X, y + RELLENO_Y, { width: ancho, align: alinear });
      if (secundario) {
        doc.font(FUENTE.normal).fontSize(TAMANO_SECUNDARIO).fillColor(COLOR.gris)
          .text(secundario, posiciones[i]! + RELLENO_X, doc.y + 1.5, { width: ancho, align: alinear });
      }
    });
    linea(doc, x0, y + alto, anchoUtil(doc), COLOR.bordeSuave);
    doc.y = y + alto;
  }
  doc.x = x0;
}

function normalizar(celda: CeldaTabla) {
  if (celda == null) return { texto: "" };
  if (typeof celda === "object") return celda;
  return { texto: String(celda) };
}

function altoFila(doc: DocumentoPdf, fila: CeldaTabla[], anchos: number[]): number {
  let maximo = 0;
  fila.forEach((celda, i) => {
    const { texto, secundario, negrita } = normalizar(celda);
    const ancho = anchos[i]! - RELLENO_X * 2;
    let alto = doc.font(negrita ? FUENTE.negrita : FUENTE.normal).fontSize(TAMANO_CELDA).heightOfString(texto || " ", { width: ancho });
    if (secundario) alto += 1.5 + doc.font(FUENTE.normal).fontSize(TAMANO_SECUNDARIO).heightOfString(secundario, { width: ancho });
    maximo = Math.max(maximo, alto);
  });
  return maximo + RELLENO_Y * 2;
}

export function linea(doc: DocumentoPdf, x: number, y: number, ancho: number, color: string) {
  doc.moveTo(x, y).lineTo(x + ancho, y).lineWidth(0.75).stroke(color);
}

/** Dibuja el pie en todas las hojas, cierra el documento y regresa el PDF. */
export async function terminar(doc: DocumentoPdf): Promise<Buffer> {
  const recibido = pedazos.get(doc)!;
  const nota = notasPie.get(doc);
  const { start, count } = doc.bufferedPageRange();
  for (let i = start; i < start + count; i++) {
    doc.switchToPage(i);
    // Sin esto, escribir debajo del margen de abajo abre una hoja nueva.
    const margenAbajo = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - ALTO_PIE;
    linea(doc, MARGEN.lados, y - 7.5, anchoUtil(doc), COLOR.bordeSuave);
    doc.font(FUENTE.normal).fontSize(7.5).fillColor(COLOR.pie);
    doc.text("NANOBRIDGE · CRM", MARGEN.lados, y, { lineBreak: false });
    const pagina = `${nota ? `${nota} · ` : ""}página ${i - start + 1} de ${count}`;
    doc.text(pagina, MARGEN.lados, y, { width: anchoUtil(doc), align: "right", lineBreak: false });
    doc.page.margins.bottom = margenAbajo;
  }
  const fin = new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });
  doc.end();
  await fin;
  return Buffer.concat(recibido);
}
