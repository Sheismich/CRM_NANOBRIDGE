import { describe, expect, it } from "vitest";
import { crearDocumentoCarta, seccion, tabla, terminar } from "../src/shared/pdf/molde.js";
import { textoDelPdf } from "./support/pdf.js";

// Molde común de los PDF (bloque 6, 12-oct-2026): hoja carta con logo, N de
// marca de agua y pie con "página N de M". La tabla aguanta listas largas
// (la va a reusar el Registro de cambios del bloque 7): cuando no cabe un
// renglón abre otra hoja y repite el encabezado.
describe("molde de PDF", () => {
  it("una hoja corta: logo, título, datos del encabezado y pie 'página 1 de 1'", async () => {
    const doc = crearDocumentoCarta({ titulo: "Informe de prueba", lineas: ["Octubre 2026 · todos los responsables", "Generado por Ana Pérez"] });
    seccion(doc, "Resumen del mes");
    const pdf = await terminar(doc);

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const hojas = await textoDelPdf(pdf);
    expect(hojas).toHaveLength(1);
    expect(hojas[0]).toContain("NANOBRIDGE");
    expect(hojas[0]).toContain("Informe de prueba");
    expect(hojas[0]).toContain("Octubre 2026 · todos los responsables");
    expect(hojas[0]).toContain("Generado por Ana Pérez");
    expect(hojas[0]).toContain("RESUMEN DEL MES");
    expect(hojas[0]).toContain("página 1 de 1");
  });

  it("una tabla larga se reparte en varias hojas y repite el encabezado en cada una", async () => {
    const doc = crearDocumentoCarta({ titulo: "Tabla larga", lineas: [] });
    const filas = Array.from({ length: 120 }, (_, i) => [`Renglón ${i + 1}`, { texto: `Descripción ${i + 1}`, secundario: "segunda línea con acentos: ñandú" }, `$${i + 1}.00`]);
    tabla(doc, {
      columnas: [
        { titulo: "Concepto", ancho: 2 },
        { titulo: "Detalle", ancho: 3 },
        { titulo: "Importe", ancho: 1, alinear: "right" }
      ],
      filas
    });
    const hojas = await textoDelPdf(await terminar(doc));

    expect(hojas.length).toBeGreaterThan(2);
    hojas.forEach((hoja, i) => {
      expect(hoja).toContain("CONCEPTO");
      expect(hoja).toContain("IMPORTE");
      expect(hoja).toContain(`página ${i + 1} de ${hojas.length}`);
    });
    const todo = hojas.join(" ");
    // Ningún renglón se pierde ni se repite al cambiar de hoja.
    for (let i = 1; i <= 120; i++) {
      expect(todo.match(new RegExp(`Renglón ${i}(?!\\d)`, "g"))).toHaveLength(1);
    }
    expect(todo).toContain("ñandú");
    expect(hojas.at(-1)).toContain("Renglón 120");
  });

  it("una tabla sin renglones dibuja el encabezado y el aviso de vacío", async () => {
    const doc = crearDocumentoCarta({ titulo: "Vacía", lineas: [] });
    tabla(doc, { columnas: [{ titulo: "Fecha", ancho: 1 }], filas: [], vacio: "Sin cambios en este periodo." });
    const hojas = await textoDelPdf(await terminar(doc));
    expect(hojas).toHaveLength(1);
    expect(hojas[0]).toContain("FECHA");
    expect(hojas[0]).toContain("Sin cambios en este periodo.");
  });
});
