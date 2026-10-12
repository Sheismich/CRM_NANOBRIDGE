import { COLOR, FUENTE, MARGEN, anchoUtil, asegurarEspacio, crearDocumentoCarta, linea, tabla, terminar, type DocumentoPdf } from "../shared/pdf/molde.js";
import { dinero, fechaCorta } from "../shared/pdf/formato.js";
import type { CotizacionesService } from "./cotizaciones.service.js";

// PDF de la cotización (bloque 6, 12-oct-2026): el "documento" del diseño
// (docs/diseno/cotizaciones.html) sobre el molde común. Sale de lo mismo que
// regresa GET /cotizaciones/:id, así que el PDF nunca dice algo distinto de
// la pantalla. Emisor = solo logo y nombre NANOBRIDGE: el RFC y el domicilio
// se agregan cuando Carlos los pase.
type Cotizacion = Awaited<ReturnType<CotizacionesService["get"]>>;

const ESTADOS: Record<Cotizacion["estado"], string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  obsoleta: "Obsoleta (hay una versión más nueva)"
};

export function nombreArchivoCotizacion(cotizacion: Pick<Cotizacion, "id" | "version">) {
  return `cotizacion-${cotizacion.id}-v${cotizacion.version}.pdf`;
}

export async function cotizacionPdf(cotizacion: Cotizacion): Promise<Buffer> {
  const emitida = `Emitida ${fechaCorta(cotizacion.fecha_emision)}`;
  const doc = crearDocumentoCarta({
    titulo: `Cotización #${cotizacion.id} · v${cotizacion.version}`,
    lineas: [
      cotizacion.fecha_esperada_cierre ? `${emitida} · vigente al ${fechaCorta(cotizacion.fecha_esperada_cierre)}` : emitida,
      `Estado: ${ESTADOS[cotizacion.estado]}`
    ]
  });

  doc.y += 21;
  const mitad = (anchoUtil(doc) - 18) / 2;
  const arriba = doc.y;
  const finPara = bloque(doc, MARGEN.lados, arriba, mitad, "Para",
    cotizacion.empresa_nombre_legal ?? cotizacion.empresa_nombre ?? "—",
    [cotizacion.contacto_nombre ? [cotizacion.contacto_nombre, cotizacion.contacto_puesto].filter(Boolean).join(" · ") : null]);
  const finOportunidad = bloque(doc, MARGEN.lados + mitad + 18, arriba, mitad, "Oportunidad",
    cotizacion.oportunidad_titulo ?? "—",
    [[cotizacion.etapa_nombre, cotizacion.probabilidad != null ? `${cotizacion.probabilidad}%` : null].filter(Boolean).join(" · ") || null]);
  doc.y = Math.max(finPara, finOportunidad) + 18;

  tabla(doc, {
    columnas: [
      { titulo: "Concepto", ancho: 5 },
      { titulo: "Cant.", ancho: 1, alinear: "right" },
      { titulo: "Precio", ancho: 2, alinear: "right" },
      { titulo: "Importe", ancho: 2, alinear: "right" }
    ],
    filas: cotizacion.partidas.map((p) => [
      { texto: p.descripcion, secundario: p.detalle, negrita: true },
      String(Number(p.cantidad)),
      dinero(p.precio_unitario),
      dinero(p.importe)
    ])
  });

  totales(doc, cotizacion);
  return terminar(doc);
}

// "PARA" chiquito, el nombre en negritas y renglones grises debajo.
// Regresa dónde terminó (y).
function bloque(doc: DocumentoPdf, x: number, y: number, ancho: number, etiqueta: string, principal: string, secundarios: (string | null)[]) {
  doc.font(FUENTE.extra).fontSize(7).fillColor(COLOR.etiqueta).text(etiqueta.toUpperCase(), x, y, { width: ancho, characterSpacing: 0.6 });
  doc.font(FUENTE.negrita).fontSize(10.5).fillColor(COLOR.tinta).text(principal, x, doc.y + 3, { width: ancho });
  doc.font(FUENTE.normal).fontSize(9).fillColor(COLOR.gris);
  for (const texto of secundarios) {
    if (texto) doc.text(texto, x, doc.y + 2, { width: ancho });
  }
  return doc.y;
}

function totales(doc: DocumentoPdf, cotizacion: Cotizacion) {
  const ancho = 210;
  const x = MARGEN.lados + anchoUtil(doc) - ancho;
  const base = Number(cotizacion.subtotal) - Number(cotizacion.descuento);
  const impuestos = Number(cotizacion.impuestos);
  // El IVA se guarda como monto, no como tasa: la tasa se saca de vuelta
  // para la etiqueta ("IVA 16%") solo si da un número limpio.
  const tasa = base > 0 && impuestos > 0 ? Number(((impuestos / base) * 100).toFixed(2)) : null;
  const etiquetaImpuestos = tasa != null && Number.isInteger(tasa * 4) ? `IVA ${tasa}%` : "Impuestos";

  // Los totales van juntos: si no caben, se pasan enteros a la hoja siguiente.
  asegurarEspacio(doc, 100);
  doc.y += 12;
  const renglon = (etiqueta: string, valor: string) => {
    const y = doc.y;
    doc.font(FUENTE.normal).fontSize(9).fillColor(COLOR.gris).text(etiqueta, x, y, { width: ancho / 2, lineBreak: false });
    doc.font(FUENTE.semi).fontSize(9).fillColor(COLOR.texto).text(valor, x + ancho / 2, y, { width: ancho / 2, align: "right", lineBreak: false });
    doc.y = y + 16;
  };
  renglon("Subtotal", dinero(cotizacion.subtotal));
  renglon("Descuento", `−${dinero(cotizacion.descuento)}`);
  renglon(etiquetaImpuestos, dinero(cotizacion.impuestos));
  linea(doc, x, doc.y + 2, ancho, COLOR.borde);
  const y = doc.y + 10;
  doc.font(FUENTE.extra).fontSize(9).fillColor(COLOR.tinta).text(`Total ${cotizacion.moneda}`, x, y + 7, { width: ancho / 2, lineBreak: false });
  doc.font(FUENTE.numeros).fontSize(18).fillColor(COLOR.azul).text(dinero(cotizacion.total), x + ancho / 2 - 30, y, { width: ancho / 2 + 30, align: "right", lineBreak: false });
  doc.x = MARGEN.lados;
  doc.y = y + 28;
}
