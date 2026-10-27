import { describe, expect, it } from "vitest";
import { EN_CAMPANA, filtroEstado, GRUPOS_EMBUDO, sePuedeMandar, textoMotivo, textoMotivos, tonoScore } from "./prospectos";

describe("embudo de Prospectos", () => {
  it("cada estado está en una sola tarjeta, para que las tarjetas no se crucen", () => {
    const estados = GRUPOS_EMBUDO.flatMap((g) => g.estados ?? []);
    expect(new Set(estados).size).toBe(estados.length);
  });

  it("En campaña y Validados se separan con enCampana; los demás filtran por estado", () => {
    expect(filtroEstado(EN_CAMPANA)).toEqual({ enCampana: "true" });
    expect(filtroEstado("validado")).toEqual({ estado: "validado", enCampana: "false" });
    expect(filtroEstado("capturado")).toEqual({ estado: "capturado" });
    expect(filtroEstado("")).toEqual({});
  });
});

describe("Mandar a automatización", () => {
  it("entran capturados, excluidos y los de la fila que la automatización no ha tomado", () => {
    expect(sePuedeMandar({ estado: "capturado", fila_tomado_en: null })).toBe(true);
    expect(sePuedeMandar({ estado: "excluido", fila_tomado_en: null })).toBe(true);
    expect(sePuedeMandar({ estado: "en_fila", fila_tomado_en: null })).toBe(true);
    expect(sePuedeMandar({ estado: "en_fila", fila_tomado_en: "2026-10-20T15:00:00Z" })).toBe(false);
    expect(sePuedeMandar({ estado: "validado", fila_tomado_en: null })).toBe(false);
    expect(sePuedeMandar({ estado: "baja", fila_tomado_en: null })).toBe(false);
  });

  it("los motivos conocidos se explican y los desconocidos se enseñan tal cual", () => {
    expect(textoMotivo("giro_no_informado")).toBe("le falta el giro de la empresa");
    expect(textoMotivo("Algo que mandó n8n")).toBe("Algo que mandó n8n");
    expect(textoMotivos(["sin_correo", "suprimido"])).toBe("no tiene un correo activo; su correo está en la lista de supresión");
  });
});

describe("anillo del score", () => {
  it("verde desde 80, ámbar desde 60, rojo abajo", () => {
    expect(tonoScore(80)).toBe("ok");
    expect(tonoScore(79.9)).toBe("warn");
    expect(tonoScore(60)).toBe("warn");
    expect(tonoScore(59)).toBe("danger");
  });
});
