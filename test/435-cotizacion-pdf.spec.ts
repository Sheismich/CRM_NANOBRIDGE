import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";
import { binario, textoDelPdf } from "./support/pdf.js";

// PDF de la cotización (bloque 6, 12-oct-2026): el documento del diseño
// (docs/diseno/cotizaciones.html) en hoja carta, con el molde común. Emisor =
// solo logo y nombre NANOBRIDGE (RFC y domicilio cuando Carlos los pase).
describe("cotizaciones: PDF", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let empresaId: number;
  const marca = randomUUID().slice(0, 8);
  const api = () => request(app.getHttpServer());

  async function oportunidad(responsableId: number, titulo: string) {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo, responsableId });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function cotizacion(oportunidadId: number, datos: Record<string, unknown>) {
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, ...datos });
    expect(res.status).toBe(201);
    return res.body as { id: number; version: number };
  }

  function pdf(id: number, cookie = adminCookie) {
    return api().get(`/api/v1/cotizaciones/${id}/pdf`).set("Cookie", cookie).buffer(true).parse(binario);
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `cot.pdf.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({
      nombreLegal: `Moldes del Bajío ${marca} SA de CV`,
      nombreComercial: `Moldes del Bajío ${marca}`,
      contactos: [{ nombre: "Ana Ruiz", puesto: "Gerente de compras", correo: `ana.${randomUUID()}@test.local` }]
    });
    expect(res.status).toBe(201);
    empresaId = res.body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("descarga el documento con empresa, contacto, oportunidad, partidas y totales", async () => {
    const contactoId = (await api().get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie)).body.contactos[0].id as number;
    const opId = await oportunidad(agenteId, "Moldes de inyección 2027");
    const { id, version } = await cotizacion(opId, {
      contactoId,
      fechaEsperadaCierre: "2026-10-31",
      probabilidad: 50,
      impuestos: 62380.8,
      partidas: [
        { descripcion: "Molde de inyección 4 cavidades", detalle: "Acero P20, incluye pruebas", cantidad: 2, precioUnitario: 168500 },
        { descripcion: "Mantenimiento preventivo anual", detalle: "4 visitas", cantidad: 1, precioUnitario: 42880 },
        { descripcion: "Capacitación a operadores", cantidad: 8, precioUnitario: 1250 }
      ]
    });

    const res = await pdf(id);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(`attachment; filename="cotizacion-${id}-v${version}.pdf"`);
    const hojas = await textoDelPdf(res.body as Buffer);
    expect(hojas).toHaveLength(1);
    const texto = hojas[0]!;
    expect(texto).toContain("NANOBRIDGE");
    expect(texto).toContain(`Cotización #${id} · v${version}`);
    expect(texto).toContain("vigente al 31 oct 2026");
    expect(texto).toContain(`Moldes del Bajío ${marca} SA de CV`);
    expect(texto).toContain("Ana Ruiz · Gerente de compras");
    expect(texto).toContain("Moldes de inyección 2027");
    expect(texto).toContain("50%");
    expect(texto).toContain("Molde de inyección 4 cavidades");
    expect(texto).toContain("Acero P20, incluye pruebas");
    expect(texto).toContain("$168,500.00");
    expect(texto).toContain("$337,000.00");
    expect(texto).toContain("$389,880.00");
    expect(texto).toContain("IVA 16%");
    expect(texto).toContain("$62,380.80");
    expect(texto).toContain("$452,260.80");
    expect(texto).toContain("MXN");
    expect(texto).toContain("Borrador");
    expect(texto).toContain("página 1 de 1");
  });

  it("muchas partidas: varias hojas con el encabezado de la tabla en cada una y los totales al final", async () => {
    const opId = await oportunidad(agenteId, `Lote grande ${marca}`);
    const partidas = Array.from({ length: 50 }, (_, i) => ({
      descripcion: `Partida número ${i + 1} con una descripción larga que ocupa espacio`,
      detalle: "Segunda línea del detalle",
      cantidad: 1,
      precioUnitario: 100
    }));
    const { id } = await cotizacion(opId, { partidas });

    const hojas = await textoDelPdf((await pdf(id)).body as Buffer);
    expect(hojas.length).toBeGreaterThan(1);
    hojas.forEach((hoja, i) => {
      // Si los totales no caben se pasan enteros a otra hoja, sin tabla.
      if (hoja.includes("Partida número")) expect(hoja).toContain("CONCEPTO");
      expect(hoja).toContain(`página ${i + 1} de ${hojas.length}`);
    });
    expect(hojas.filter((hoja) => hoja.includes("CONCEPTO")).length).toBeGreaterThan(1);
    expect(hojas.join(" ")).toContain("Partida número 50 con");
    expect(hojas.at(-1)).toContain("$5,000.00");
    expect(hojas.slice(0, -1).join(" ")).not.toContain("Total");
  });

  it("un agente baja las de sus oportunidades y no las de otro (404)", async () => {
    const propia = await cotizacion(await oportunidad(agenteId, `Propia ${marca}`), { partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 10 }] });
    const ajena = await cotizacion(await oportunidad((await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id, `Ajena ${marca}`), { partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 10 }] });

    expect((await pdf(propia.id, agenteCookie)).status).toBe(200);
    expect((await api().get(`/api/v1/cotizaciones/${ajena.id}/pdf`).set("Cookie", agenteCookie)).status).toBe(404);
    expect((await api().get("/api/v1/cotizaciones/999999999/pdf").set("Cookie", adminCookie)).status).toBe(404);
  });
});
