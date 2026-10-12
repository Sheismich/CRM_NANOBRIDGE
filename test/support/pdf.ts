import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Lee un PDF generado por la API y devuelve el texto de cada hoja (una
// cadena por hoja, los pedazos unidos con espacio). pdfkit guarda el texto
// con las fuentes incrustadas, así que buscarlo en los bytes crudos no
// sirve: hay que leerlo con un lector de PDF de verdad.
export async function textoDelPdf(pdf: Buffer): Promise<string[]> {
  const carga = getDocument({ data: new Uint8Array(pdf), disableFontFace: true, useSystemFonts: false });
  const documento = await carga.promise;
  const hojas: string[] = [];
  for (let numero = 1; numero <= documento.numPages; numero++) {
    const hoja = await documento.getPage(numero);
    const contenido = await hoja.getTextContent();
    hojas.push(contenido.items.map((item) => ("str" in item ? item.str : "")).join(" ").replace(/\s+/g, " "));
  }
  await carga.destroy();
  return hojas;
}

// Junta la respuesta binaria completa en un Buffer (supertest le pasa la
// respuesta HTTP cruda, que es un stream).
export function binario(res: unknown, callback: (error: Error | null, body: Buffer) => void) {
  const stream = res as NodeJS.ReadableStream;
  const partes: Buffer[] = [];
  stream.on("data", (parte: Buffer) => partes.push(parte));
  stream.on("end", () => callback(null, Buffer.concat(partes)));
}
