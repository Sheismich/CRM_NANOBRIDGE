import { afterEach, describe, expect, it, vi } from "vitest";
import type { CotizacionTablero } from "../types";
import { avisoCotizacion, diasDesde } from "./cotizaciones";

const cotizacion = (datos: Partial<CotizacionTablero>) =>
  ({ estado: "enviada", dias_para_cierre: null, dias_desde_envio: null, fecha_esperada_cierre: null, fecha_envio: null, motivo_rechazo: null, actualizado_en: "2026-10-20T18:00:00.000Z", ...datos }) as CotizacionTablero;
const motivo = (clave: string) => ({ precio: "Precio alto" })[clave] ?? clave;

describe("avisos de las tarjetas de Cotizaciones", () => {
  it("enviada que vence en 3 días o menos: aviso urgente", () => {
    expect(avisoCotizacion(cotizacion({ dias_para_cierre: 3 }), motivo)).toEqual({ texto: "Vence en 3 días", tono: "warn", urgente: true });
    expect(avisoCotizacion(cotizacion({ dias_para_cierre: 1 }), motivo).texto).toBe("Vence mañana");
    expect(avisoCotizacion(cotizacion({ dias_para_cierre: 0 }), motivo).texto).toBe("Vence hoy");
    expect(avisoCotizacion(cotizacion({ dias_para_cierre: -2 }), motivo).texto).toBe("Ya pasó su cierre");
  });

  it("enviada sin respuesta desde hace 5 días o más: aviso urgente; con 4, todavía no", () => {
    expect(avisoCotizacion(cotizacion({ dias_desde_envio: 5, dias_para_cierre: 20 }), motivo)).toEqual({ texto: "Sin respuesta hace 5 días", tono: "warn", urgente: true });
    expect(avisoCotizacion(cotizacion({ dias_desde_envio: 4, fecha_envio: "2026-10-23" }), motivo)).toEqual({ texto: "Enviada el 23 oct", tono: "neutro", urgente: false });
  });

  it("que venza pesa más que llevar días sin respuesta", () => {
    expect(avisoCotizacion(cotizacion({ dias_desde_envio: 9, dias_para_cierre: 2 }), motivo).texto).toBe("Vence en 2 días");
  });

  it("las fechas DATE salen en el día correcto en México (no el anterior)", () => {
    expect(avisoCotizacion(cotizacion({ fecha_esperada_cierre: "2026-11-01" }), motivo).texto).toBe("Vigente al 1 nov");
    expect(avisoCotizacion(cotizacion({ estado: "vencida", fecha_esperada_cierre: "2026-10-01" }), motivo).texto).toBe("Venció el 1 oct");
  });

  it("borrador, aceptada y rechazada", () => {
    expect(avisoCotizacion(cotizacion({ estado: "borrador" }), motivo)).toEqual({ texto: "Falta enviar", tono: "neutro", urgente: false });
    expect(avisoCotizacion(cotizacion({ estado: "aceptada" }), motivo)).toEqual({ texto: "Aceptada el 20 oct", tono: "ok", urgente: false });
    expect(avisoCotizacion(cotizacion({ estado: "rechazada", motivo_rechazo: "precio" as CotizacionTablero["motivo_rechazo"] }), motivo).texto).toBe("Motivo: precio alto");
    expect(avisoCotizacion(cotizacion({ estado: "rechazada" }), motivo).texto).toBe("Sin motivo registrado");
  });
});

describe("diasDesde", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("cuenta días de calendario en México, también de noche", () => {
    vi.useFakeTimers();
    // 27 oct a las 23:30 de México (ya es 28 en UTC): siguen siendo 5 días desde el 22.
    vi.setSystemTime(new Date("2026-10-28T05:30:00Z"));
    expect(diasDesde("2026-10-22")).toBe(5);
    expect(diasDesde("2026-10-27")).toBe(0);
  });
});
