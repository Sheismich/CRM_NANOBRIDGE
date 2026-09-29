import { describe, expect, it } from "vitest";
import { filaCsvSchema } from "../src/crm/dto/prospecto.schema.js";

// Una fila de CSV la escribe una persona en Excel: los catálogos no deben
// fallar por mayúsculas o acentos, y cuando fallan el mensaje se muestra
// tal cual en la revisión fila por fila de la pantalla de Prospectos.
describe("filaCsvSchema (validación de filas de CSV)", () => {
  const base = { empresaNombreLegal: "Aceros del Bajío", contactoNombre: "Ricardo Peña", correo: "ricardo@acerosbajio.mx", telefono: "+52 477 123 4567" };

  it("acepta catálogos en mayúsculas o con acentos y los normaliza", () => {
    const res = filaCsvSchema.safeParse({ ...base, empresaTamano: "Pequeña", canalInicial: "Teléfono", confianza: "ALTA", prioridad: " Media " });
    expect(res.success).toBe(true);
    expect(res.data).toMatchObject({ empresaTamano: "pequena", canalInicial: "telefono", confianza: "alta", prioridad: "media" });
  });

  it("rechaza un valor fuera de catálogo con un mensaje en español que dice qué se acepta", () => {
    const res = filaCsvSchema.safeParse({ ...base, empresaTamano: "enorme", canalInicial: "fax" });
    expect(res.success).toBe(false);
    const mensajes = Object.fromEntries(res.error!.issues.map((i) => [i.path.join("."), i.message]));
    expect(mensajes.empresaTamano).toBe("Valor no válido; usa micro, pequena, mediana o grande");
    expect(mensajes.canalInicial).toBe("Valor no válido; usa correo, telefono o whatsapp");
  });

  it("explica en español un correo inválido y un nombre faltante", () => {
    const res = filaCsvSchema.safeParse({ empresaNombreLegal: "Aceros del Bajío", correo: "no-es-correo", canalInicial: "correo" });
    expect(res.success).toBe(false);
    const mensajes = Object.fromEntries(res.error!.issues.map((i) => [i.path.join("."), i.message]));
    expect(mensajes.correo).toBe("Correo no válido");
    expect(mensajes.contactoNombre).toBe("Falta el nombre del contacto");
  });

  it("rechaza en español una URL que no es http/https (sitio web o fuente)", () => {
    const res = filaCsvSchema.safeParse({ ...base, canalInicial: "correo", empresaSitioWeb: "javascript:alert(1)", fuenteUrl: "acerosbajio.mx" });
    expect(res.success).toBe(false);
    const mensajes = Object.fromEntries(res.error!.issues.map((i) => [i.path.join("."), i.message]));
    expect(mensajes.empresaSitioWeb).toBe("URL no válida; debe empezar con http:// o https://");
    expect(mensajes.fuenteUrl).toBe("URL no válida; debe empezar con http:// o https://");
  });
});
