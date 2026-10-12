// svg-to-pdfkit no trae tipos propios (ni hay @types). Solo se usa para
// dibujar el logo dentro de los PDF (src/shared/pdf/molde.ts).
declare module "svg-to-pdfkit" {
  interface OpcionesSvg {
    width?: number;
    height?: number;
    preserveAspectRatio?: string;
    assumePt?: boolean;
  }
  export default function SVGtoPDF(doc: PDFKit.PDFDocument, svg: string, x: number, y: number, opciones?: OpcionesSvg): void;
}
