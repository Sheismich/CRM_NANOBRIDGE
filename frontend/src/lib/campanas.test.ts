import { describe, expect, it } from "vitest";
import { avisoCorreos } from "./campanas";

// Correos por campaña (9-nov-2026): al mandar a automatización se avisa si
// la campaña saldrá con los correos generales.
describe("aviso de correos de la campaña", () => {
  it("sin propios dice que salen los generales y dónde se escriben los suyos", () => {
    expect(avisoCorreos({ correos_propios: 0 })).toContain("saldrán los generales");
    expect(avisoCorreos({ correos_propios: 0 })).toContain("botón Campañas");
  });

  it("con algunos dice cuántos salen con el general", () => {
    expect(avisoCorreos({ correos_propios: 1 })).toBe("Esta campaña tiene 1 correo propio; los otros 2 saldrán con el general.");
    expect(avisoCorreos({ correos_propios: 2 })).toBe("Esta campaña tiene 2 correos propios; el otro saldrá con el general.");
  });

  it("con los 3 propios, o sin campaña, no hay aviso", () => {
    expect(avisoCorreos({ correos_propios: 3 })).toBeNull();
    expect(avisoCorreos(undefined)).toBeNull();
  });
});
