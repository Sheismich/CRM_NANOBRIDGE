import { describe, expect, it } from "vitest";
import { fechaMx, finSiguienteDiaHabilMx } from "../src/shared/dia-habil.js";

// La fecha límite de "Contactar prospecto interesado" se calcula en hora de
// México, no en la del servidor (Cloud Run corre en UTC): un jueves a las
// 7 pm en México ya es viernes en UTC, y calcular en UTC daba lunes.
// México no tiene horario de verano desde 2022 (UTC-6 todo el año).
describe("finSiguienteDiaHabilMx", () => {
  it("jueves 19:00 en México (viernes 01:00 UTC) → fin del viernes, no lunes", () => {
    expect(finSiguienteDiaHabilMx(new Date("2026-10-02T01:00:00Z")).toISOString()).toBe("2026-10-03T05:59:59.000Z");
  });

  it("viernes 10:00 en México → fin del lunes", () => {
    expect(finSiguienteDiaHabilMx(new Date("2026-10-02T16:00:00Z")).toISOString()).toBe("2026-10-06T05:59:59.000Z");
  });

  it("sábado y domingo → fin del lunes", () => {
    expect(finSiguienteDiaHabilMx(new Date("2026-10-03T18:00:00Z")).toISOString()).toBe("2026-10-06T05:59:59.000Z");
    expect(finSiguienteDiaHabilMx(new Date("2026-10-04T18:00:00Z")).toISOString()).toBe("2026-10-06T05:59:59.000Z");
  });

  it("lunes 23:30 en México → fin del martes", () => {
    expect(finSiguienteDiaHabilMx(new Date("2026-10-06T05:30:00Z")).toISOString()).toBe("2026-10-07T05:59:59.000Z");
  });
});

// La fecha de calendario en México: la conexión a MySQL corre en UTC, así
// que CURDATE() cambia de día a las 6 pm de México (campañas, 1-oct-2026).
describe("fechaMx", () => {
  it("las 7 pm del jueves en México (ya viernes 01:00 UTC) siguen siendo jueves", () => {
    expect(fechaMx(new Date("2026-10-02T01:00:00Z"))).toBe("2026-10-01");
  });

  it("medianoche en México cambia de día", () => {
    expect(fechaMx(new Date("2026-10-02T05:59:59Z"))).toBe("2026-10-01");
    expect(fechaMx(new Date("2026-10-02T06:00:00Z"))).toBe("2026-10-02");
  });
});
