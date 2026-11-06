import { describe, expect, it } from "vitest";
import { accionesDelTipo, cambiarTipo, diaMx, errorDeRango, filtrosIniciales, hayFiltros, horaMx, parametrosRegistro, rangoActivo, rangoRapido, urlExportar, type AccionRegistro } from "./registro-cambios";

const ACCIONES: AccionRegistro[] = [
  { clave: "usuario:crear", etiqueta: "Alta de usuario", tipo: "usuarios_roles" },
  { clave: "empresa:crear", etiqueta: "Alta de empresa", tipo: "ediciones" },
  { clave: "empresa:actualizar", etiqueta: "Edición de empresa", tipo: "ediciones" }
];

// 6-nov-2026, 3 pm en México (UTC-6).
const AHORA = new Date("2026-11-06T21:00:00Z");

describe("diaMx: el día que marca el calendario en México", () => {
  it("cambia a medianoche de México, no a la de UTC", () => {
    expect(diaMx(new Date("2026-11-07T05:59:59Z"))).toBe("2026-11-06");
    expect(diaMx(new Date("2026-11-07T06:00:00Z"))).toBe("2026-11-07");
    expect(horaMx(new Date("2026-11-07T05:59:59Z"))).toBe("23:59");
  });
});

describe("rangos", () => {
  it("empieza en los últimos 30 días contando hoy, igual que el rango por omisión de la API", () => {
    expect(filtrosIniciales(AHORA)).toEqual({ tipo: "todo", q: "", desde: "2026-10-08", hasta: "2026-11-06", usuarioId: null, accion: "" });
  });

  it("los atajos dan hoy, ayer, 7 y 30 días", () => {
    expect(rangoRapido("hoy", AHORA)).toEqual({ desde: "2026-11-06", hasta: "2026-11-06" });
    expect(rangoRapido("ayer", AHORA)).toEqual({ desde: "2026-11-05", hasta: "2026-11-05" });
    expect(rangoRapido("7", AHORA)).toEqual({ desde: "2026-10-31", hasta: "2026-11-06" });
    expect(rangoRapido("30", AHORA)).toEqual({ desde: "2026-10-08", hasta: "2026-11-06" });
  });

  it("reconoce qué atajo está puesto, y ninguno si las fechas son a mano", () => {
    expect(rangoActivo({ desde: "2026-11-05", hasta: "2026-11-05" }, AHORA)).toBe("ayer");
    expect(rangoActivo({ desde: "2026-11-03", hasta: "2026-11-03" }, AHORA)).toBeNull();
  });
});

describe("errorDeRango: sin rango válido no se consulta ni se exporta", () => {
  it("acepta un solo día y un rango", () => {
    expect(errorDeRango({ desde: "2026-11-03", hasta: "2026-11-03" })).toBeNull();
    expect(errorDeRango({ desde: "2026-11-01", hasta: "2026-11-03" })).toBeNull();
  });

  it("pide las dos fechas", () => {
    expect(errorDeRango({ desde: "", hasta: "2026-11-03" })).toBe("Elige las dos fechas.");
    expect(errorDeRango({ desde: "2026-11-03", hasta: "" })).toBe("Elige las dos fechas.");
  });

  it("no deja que Desde pase a Hasta", () => {
    expect(errorDeRango({ desde: "2026-11-04", hasta: "2026-11-03" })).toBe("La fecha Desde no puede ser después de Hasta.");
  });

  it("un año a medio escribir (0202) no es una fecha todavía", () => {
    expect(errorDeRango({ desde: "0202-11-03", hasta: "2026-11-03" })).toBe("Elige las dos fechas.");
  });
});

describe("parametrosRegistro: lo mismo para la lista y para exportar", () => {
  it("manda siempre las dos fechas, y lo vacío no se manda", () => {
    expect(parametrosRegistro(filtrosIniciales(AHORA))).toEqual({ tipo: "todo", desde: "2026-10-08", hasta: "2026-11-06" });
  });

  it("manda persona, acción y búsqueda cuando las hay", () => {
    const filtros = { tipo: "ediciones" as const, q: "Moldes", desde: "2026-11-03", hasta: "2026-11-03", usuarioId: 7, accion: "empresa:crear" };
    expect(parametrosRegistro(filtros)).toEqual({ tipo: "ediciones", q: "Moldes", desde: "2026-11-03", hasta: "2026-11-03", usuarioId: 7, accion: "empresa:crear" });
  });

  it("la exportación lleva esos mismos filtros más el formato", () => {
    const filtros = { tipo: "ediciones" as const, q: "Moldes y Cía", desde: "2026-11-03", hasta: "2026-11-03", usuarioId: 7, accion: "empresa:crear" };
    const [ruta, consulta] = urlExportar(filtros, "pdf").split("?");
    expect(ruta).toBe("/api/v1/admin/registro-cambios/export");
    expect(Object.fromEntries(new URLSearchParams(consulta))).toEqual({ formato: "pdf", tipo: "ediciones", q: "Moldes y Cía", desde: "2026-11-03", hasta: "2026-11-03", usuarioId: "7", accion: "empresa:crear" });
  });
});

describe("acción y tipo", () => {
  it("con Todo salen todas las acciones; con un tipo, solo las suyas", () => {
    expect(accionesDelTipo(ACCIONES, "todo")).toHaveLength(3);
    expect(accionesDelTipo(ACCIONES, "ediciones").map((a) => a.clave)).toEqual(["empresa:crear", "empresa:actualizar"]);
  });

  it("al cambiar de tipo se quita la acción que ya no le corresponde", () => {
    const filtros = { ...filtrosIniciales(AHORA), accion: "empresa:crear" };
    expect(cambiarTipo(filtros, "ediciones", ACCIONES).accion).toBe("empresa:crear");
    expect(cambiarTipo(filtros, "todo", ACCIONES).accion).toBe("empresa:crear");
    expect(cambiarTipo(filtros, "usuarios_roles", ACCIONES)).toMatchObject({ tipo: "usuarios_roles", accion: "" });
  });
});

describe("hayFiltros: si tiene caso mostrar \"Quitar filtros\"", () => {
  it("no al inicio; sí con cualquier cambio", () => {
    const inicio = filtrosIniciales(AHORA);
    expect(hayFiltros(inicio, AHORA)).toBe(false);
    expect(hayFiltros({ ...inicio, tipo: "borrados" }, AHORA)).toBe(true);
    expect(hayFiltros({ ...inicio, q: "x" }, AHORA)).toBe(true);
    expect(hayFiltros({ ...inicio, usuarioId: 3 }, AHORA)).toBe(true);
    expect(hayFiltros({ ...inicio, accion: "empresa:crear" }, AHORA)).toBe(true);
    expect(hayFiltros({ ...inicio, desde: "2026-11-03" }, AHORA)).toBe(true);
  });
});
