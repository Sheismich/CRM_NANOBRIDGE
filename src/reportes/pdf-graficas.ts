import { COLOR, FUENTE, type DocumentoPdf } from "../shared/pdf/molde.js";
import { dineroCorto, mesCorto } from "../shared/pdf/formato.js";

// Gráficas dibujadas con pdfkit que comparten el informe ejecutivo y el
// reporte del periodo (16-oct-2026): barras de conversión por etapa y
// columnas del forecast (valor total con el ponderado adentro).

export type EtapaGrafica = { clave: string; nombre: string; alcanzadas: number; pct: number | null };
export type MesForecast = { mes: string; valor_total: string; valor_ponderado: string };

const COLOR_ETAPA: Record<string, string> = {
  calificada: COLOR.ambar,
  descubrimiento: COLOR.cian,
  propuesta: COLOR.azul,
  negociacion: COLOR.morado,
  verbalmente_ganada: "#1f9e8a",
  ganada: COLOR.verde
};

export function barrasEtapas(doc: DocumentoPdf, etapas: EtapaGrafica[], x: number, y: number, ancho: number, vacio: string) {
  const etiqueta = 86;
  const valor = 42;
  const pista = ancho - etiqueta - valor - 12;
  let fila = y;
  if (etapas.length === 0) {
    doc.font(FUENTE.normal).fontSize(8.6).fillColor(COLOR.gris).text(vacio, x, fila, { width: ancho });
    return;
  }
  for (const etapa of etapas) {
    doc.font(FUENTE.normal).fontSize(8.6).fillColor(COLOR.texto).text(etapa.nombre, x, fila, { width: etiqueta, lineBreak: false });
    doc.roundedRect(x + etiqueta + 6, fila + 1, pista, 9, 4.5).fill(COLOR.bordeSuave);
    const lleno = Math.max(0, Math.min(1, (etapa.pct ?? 0) / 100)) * pista;
    if (lleno > 0) doc.roundedRect(x + etiqueta + 6, fila + 1, Math.max(lleno, 9), 9, 4.5).fill(COLOR_ETAPA[etapa.clave] ?? COLOR.azul);
    doc.font(FUENTE.extra).fontSize(8.6).fillColor(COLOR.tinta)
      .text(`${etapa.alcanzadas} · ${etapa.pct == null ? "—" : `${Math.round(etapa.pct)}%`}`, x + ancho - valor, fila, { width: valor, align: "right", lineBreak: false });
    fila += 17.25;
  }
  doc.y = fila;
}

export function graficaForecast(doc: DocumentoPdf, meses: MesForecast[], x: number, y: number, ancho: number) {
  const altoMaximo = 74;
  const separacion = 10.5;
  const columna = (ancho - separacion * (meses.length - 1)) / meses.length;
  const maximo = Math.max(...meses.map((f) => Number(f.valor_total)), 0);
  const base = y + 14 + altoMaximo;
  meses.forEach((f, i) => {
    const cx = x + i * (columna + separacion);
    const total = Number(f.valor_total);
    const alto = maximo > 0 ? Math.max((total / maximo) * altoMaximo, total > 0 ? 3 : 0) : 0;
    const ponderado = maximo > 0 ? (Number(f.valor_ponderado) / maximo) * altoMaximo : 0;
    if (alto > 0) {
      doc.save();
      doc.roundedRect(cx, base - alto, columna, alto, 4.5).clip();
      doc.rect(cx, base - alto, columna, alto).fill(COLOR.lavanda);
      if (ponderado > 0) doc.rect(cx, base - ponderado, columna, ponderado).fill(COLOR.cian);
      doc.restore();
    } else {
      doc.rect(cx, base - 1, columna, 1).fill(COLOR.borde);
    }
    doc.font(FUENTE.extra).fontSize(7.9).fillColor(COLOR.tinta).text(dineroCorto(f.valor_total), cx - 6, base - alto - 11, { width: columna + 12, align: "center", lineBreak: false });
    doc.font(FUENTE.normal).fontSize(7.5).fillColor(COLOR.gris).text(mesCorto(f.mes), cx, base + 4, { width: columna, align: "center", lineBreak: false });
  });
  const yLeyenda = base + 19;
  doc.roundedRect(x, yLeyenda + 1, 6.75, 6.75, 1.5).fill(COLOR.lavanda);
  doc.font(FUENTE.normal).fontSize(7.5).fillColor(COLOR.etiqueta).text("valor total", x + 10, yLeyenda, { lineBreak: false });
  doc.roundedRect(x + 58, yLeyenda + 1, 6.75, 6.75, 1.5).fill(COLOR.cian);
  doc.fillColor(COLOR.etiqueta).text("ponderado", x + 68, yLeyenda, { lineBreak: false });
  doc.y = yLeyenda + 12;
}
