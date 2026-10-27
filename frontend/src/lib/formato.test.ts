import { describe, expect, it } from "vitest";
import { compacto, etiquetaMes, fechaLocal, fechaUtc, formatoTamano, plural } from "./formato";

describe("formatos", () => {
  it("compacto: miles con K y millones con hasta dos decimales", () => {
    expect(compacto.format(120_000)).toBe("$120K");
    expect(compacto.format(1_280_000)).toBe("$1.28M");
    expect(compacto.format(1_000_000)).toBe("$1M");
    expect(compacto.format(950)).toBe("$950");
  });

  it("fechaLocal: una columna DATE es ese día en México, no el anterior", () => {
    const d = fechaLocal("2026-10-01");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2026, 10, 1]);
  });

  it("fechaUtc: lo que manda MySQL sin la Z se lee como UTC", () => {
    const d = fechaUtc("2026-10-01 05:30:00");
    // 05:30 UTC son las 23:30 del día anterior en México.
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([30, 23, 30]);
    expect(fechaUtc("2026-10-01T05:30:00.000Z").getTime()).toBe(d.getTime());
  });

  it("etiquetaMes, plural y formatoTamano", () => {
    expect(etiquetaMes("2026-10")).toMatch(/^oct\.? 2026$/);
    expect(plural(1, "oportunidad abierta", "oportunidades abiertas")).toBe("1 oportunidad abierta");
    expect(plural(3, "oportunidad abierta", "oportunidades abiertas")).toBe("3 oportunidades abiertas");
    expect(formatoTamano(512)).toBe("512 B");
    expect(formatoTamano(2048)).toBe("2 KB");
    expect(formatoTamano(5 * 1024 * 1024)).toBe("5.0 MB");
  });
});
