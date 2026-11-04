import { describe, expect, it } from "vitest";
import { iniciales } from "./usuario";

describe("iniciales", () => {
  it("toma la primera letra de las dos primeras palabras", () => {
    expect(iniciales("Ana López")).toBe("AL");
    expect(iniciales("  ángel   ruiz  ")).toBe("ÁR");
    expect(iniciales("Fabián")).toBe("F");
  });

  it("ignora paréntesis y signos", () => {
    expect(iniciales("Mich (pasante)")).toBe("MP");
    expect(iniciales("\"Beto\" - Ventas")).toBe("BV");
  });
});
