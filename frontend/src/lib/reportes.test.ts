import { describe, expect, it } from "vitest";
import type { ConversionConCiclo, DesempenoAgente, ProspeccionDia } from "../types";
import { caidaMaxima, cambioPct, cambioPuntos, fechaLarga, fraseConversion, fraseDesempeno, fraseProspeccion, moverDia, pct, rangosDelPeriodo } from "./reportes";

// Fecha local de México, sin hora: así arma el front el "hoy" de Reportes.
const dia = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 15, 30);
};

describe("rangosDelPeriodo: del inicio del periodo a hoy, contra el mismo tramo del anterior", () => {
  it("mes: del 1 al 15 de octubre contra del 1 al 15 de septiembre", () => {
    expect(rangosDelPeriodo("mes", dia("2026-10-15"))).toEqual({
      actual: { fechaInicio: "2026-10-01", fechaFin: "2026-10-15" },
      anterior: { fechaInicio: "2026-09-01", fechaFin: "2026-09-15" },
      contra: "sep",
      titulo: "octubre"
    });
  });

  it("mes: el 31 de marzo se compara contra todo febrero, que es más corto", () => {
    expect(rangosDelPeriodo("mes", dia("2026-03-31")).anterior).toEqual({ fechaInicio: "2026-02-01", fechaFin: "2026-02-28" });
  });

  it("mes: en enero el anterior es diciembre del año pasado", () => {
    const r = rangosDelPeriodo("mes", dia("2027-01-10"));
    expect(r.anterior).toEqual({ fechaInicio: "2026-12-01", fechaFin: "2026-12-10" });
    expect(r.contra).toBe("dic");
  });

  it("semana: empieza en lunes, también si hoy es domingo", () => {
    expect(rangosDelPeriodo("semana", dia("2026-10-21")).actual).toEqual({ fechaInicio: "2026-10-19", fechaFin: "2026-10-21" });
    expect(rangosDelPeriodo("semana", dia("2026-10-25")).actual).toEqual({ fechaInicio: "2026-10-19", fechaFin: "2026-10-25" });
    expect(rangosDelPeriodo("semana", dia("2026-10-21")).anterior).toEqual({ fechaInicio: "2026-10-12", fechaFin: "2026-10-14" });
  });

  it("trimestre: oct–dic contra el mismo tramo de jul–sep", () => {
    const r = rangosDelPeriodo("trimestre", dia("2026-11-20"));
    expect(r.actual).toEqual({ fechaInicio: "2026-10-01", fechaFin: "2026-11-20" });
    expect(r.anterior).toEqual({ fechaInicio: "2026-07-01", fechaFin: "2026-08-20" });
    expect(r.titulo).toBe("oct–dic");
  });

  it("año: contra el mismo día del año pasado (y un 29 de febrero, contra el 28)", () => {
    const r = rangosDelPeriodo("anio", dia("2026-10-27"));
    expect(r.actual).toEqual({ fechaInicio: "2026-01-01", fechaFin: "2026-10-27" });
    expect(r.anterior).toEqual({ fechaInicio: "2025-01-01", fechaFin: "2025-10-27" });
    expect(r.contra).toBe("2025");
    expect(rangosDelPeriodo("anio", dia("2028-02-29")).anterior.fechaFin).toBe("2027-02-28");
  });
});

describe("flechas contra el periodo anterior", () => {
  it("cambioPct sube, baja y respeta cuando conviene que baje", () => {
    expect(cambioPct(118, 100, "sep")).toEqual({ texto: "▲ 18% vs sep", tono: "ok" });
    expect(cambioPct(80, 100, "sep")).toEqual({ texto: "▼ 20% vs sep", tono: "danger" });
    expect(cambioPct(80, 100, "sep", false)).toEqual({ texto: "▼ 20% vs sep", tono: "ok" });
  });

  it("cambioPct con el anterior en cero o sin dato", () => {
    expect(cambioPct(5, 0, "sep")).toEqual({ texto: "▲ nuevo vs sep", tono: "ok" });
    expect(cambioPct(0, 0, "sep")).toEqual({ texto: "igual que sep", tono: "neutro" });
    expect(cambioPct(5, null, "sep")).toBeNull();
  });

  it("cambioPuntos entre dos porcentajes", () => {
    expect(cambioPuntos(12.5, 9.8, "sep")).toEqual({ texto: "▲ 2.7 pts vs sep", tono: "ok" });
    expect(cambioPuntos(9.8, 12.5, "sep")).toEqual({ texto: "▼ 2.7 pts vs sep", tono: "danger" });
    expect(cambioPuntos(null, 12.5, "sep")).toBeNull();
  });

  it("pct redondea a un decimal y sin dato pone una raya", () => {
    expect(pct(33.333)).toBe("33.3%");
    expect(pct(null)).toBe("—");
  });
});

describe("frases de las gráficas", () => {
  const conversion = (base: number, etapas: Partial<ConversionConCiclo["etapas"][number]>[]) => ({ base_calificadas: base, etapas }) as unknown as ConversionConCiclo;

  it("conversión: sin calificadas, sin ganadas y con ganadas", () => {
    expect(fraseConversion(conversion(0, []))).toBe("Todavía no hay oportunidades calificadas en este periodo.");
    expect(fraseConversion(conversion(10, [{ etapa_clave: "ganada", oportunidades_alcanzadas: 0 }]))).toBe("Ninguna de las 10 oportunidades calificadas se ha ganado todavía.");
    expect(fraseConversion(conversion(10, [{ etapa_clave: "ganada", oportunidades_alcanzadas: 2, conversion_desde_calificada_pct: 20 }]))).toBe(
      "De cada 5 oportunidades calificadas, 1 se cierra con éxito (20% de tasa neta)."
    );
  });

  it("caída máxima entre dos etapas seguidas", () => {
    const c = conversion(10, [
      { orden: 1, etapa_nombre: "Calificada", conversion_desde_calificada_pct: 100 },
      { orden: 3, etapa_nombre: "Negociación", conversion_desde_calificada_pct: 30 },
      { orden: 2, etapa_nombre: "Propuesta", conversion_desde_calificada_pct: 64 }
    ]);
    expect(caidaMaxima(c)).toBe("Calificada → Propuesta (−36%)");
    expect(caidaMaxima(conversion(10, [{ orden: 1, etapa_nombre: "Calificada", conversion_desde_calificada_pct: 100 }]))).toBeNull();
  });

  it("prospección: el mejor día con su día de la semana", () => {
    const dias = [
      { fecha: "2026-10-20", envios: 10, respuestas: 1 },
      { fecha: "2026-10-21", envios: 10, respuestas: 4 }
    ] as ProspeccionDia[];
    expect(fraseProspeccion(dias)).toBe("El mejor día de respuestas fue el miércoles 21 de octubre, con 4.");
    expect(fraseProspeccion([{ fecha: "2026-10-21", envios: 7, respuestas: 0 }] as ProspeccionDia[])).toBe("Salieron 7 correos y todavía no hay respuestas.");
    expect(fraseProspeccion([])).toBe("No salieron correos de la prospección en este periodo.");
  });

  it("desempeño: quién lleva el volumen, los cierres y las vencidas", () => {
    const agente = (id: number, nombre: string, actividades: number, ganadas: number, vencidas: number) =>
      ({ responsable_id: id, responsable_nombre: nombre, actividades: { total: actividades }, oportunidades: { ganadas }, tareas: { vencidas } }) as unknown as DesempenoAgente;
    expect(fraseDesempeno([agente(1, "Laura Gómez", 30, 2, 0), agente(2, "Jorge Ruiz", 10, 1, 3)])).toBe("Laura lleva el volumen (30 actividades) y 2 de los 3 cierres; Laura no tiene tareas vencidas.");
    expect(fraseDesempeno([agente(1, "Laura Gómez", 30, 0, 0), agente(2, "Jorge Ruiz", 10, 1, 0)])).toBe("Laura lleva el volumen (30 actividades); Jorge lleva más cierres (1); nadie tiene tareas vencidas.");
    expect(fraseDesempeno([])).toBe("No hay agentes activos.");
  });
});

describe("vista Día", () => {
  it("fechaLarga y moverDia cruzan meses y años", () => {
    expect(fechaLarga("2026-10-08")).toBe("Jueves 8 de octubre de 2026");
    expect(moverDia("2026-10-31", 1)).toBe("2026-11-01");
    expect(moverDia("2026-01-01", -1)).toBe("2025-12-31");
  });
});
