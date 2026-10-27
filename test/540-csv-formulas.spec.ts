import { describe, expect, it } from "vitest";
import { toCsv } from "../src/shared/csv.js";

// Inyección de fórmulas en CSV (OWASP): un valor que empieza con =, +, -, @,
// tabulador o retorno de carro se abre en Excel como fórmula. toCsv le
// antepone un apóstrofo para que quede como texto.
describe("toCsv: no deja fórmulas que Excel ejecute", () => {
  const celda = (valor: string) => toCsv([{ nombre: valor }]).replace(/^\uFEFF/, "").split("\r\n")[1];

  it("antepone un apóstrofo a lo que empieza con un disparador de fórmula", () => {
    expect(celda("=HYPERLINK(\"http://malo.test\",\"Ver\")")).toBe(`"'=HYPERLINK(""http://malo.test"",""Ver"")"`);
    expect(celda("+52 442 123 4567")).toBe("'+52 442 123 4567");
    expect(celda("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(celda("-2+3")).toBe("'-2+3");
    expect(celda("\t=1+1")).toBe("'\t=1+1");
    expect(celda("\r=1+1")).toBe(`"'\r=1+1"`);
  });

  it("lo normal no se toca", () => {
    expect(celda("Moldes del Bajío")).toBe("Moldes del Bajío");
    expect(celda("ana@cliente.test")).toBe("ana@cliente.test");
  });
});
