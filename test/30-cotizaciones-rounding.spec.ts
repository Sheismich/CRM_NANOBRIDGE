import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";

// Cubre CotizacionesService.calcular() (cotizaciones.service.ts) y
// validarMontos (dto/cotizacion.schema.ts). Desde D1 (plan de fixes,
// 5-oct-2026) el dinero se calcula en centavos enteros, con redondeo de la
// mitad hacia arriba por línea. Antes se multiplicaba con decimales de
// JavaScript: 0.5 × 2.01 = 1.00499999… y toFixed(2) daba 1.00 en vez de
// 1.01 -- un centavo de menos que el cliente sí ve en su calculadora.
describe("cotizaciones: dinero en centavos", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;
  let oportunidadId: number;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    const empresaRes = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Redondeo SA de CV", contactos: [{ nombre: "Contacto Redondeo", correo: "contacto.redondeo@test.local" }] });
    expect(empresaRes.status).toBe(201);
    empresaId = empresaRes.body.id;

    const oportunidadRes = await request(app.getHttpServer())
      .post("/api/v1/oportunidades")
      .set("Cookie", adminCookie)
      .send({ empresaId, titulo: "Oportunidad de prueba de redondeo" });
    expect(oportunidadRes.status).toBe(201);
    oportunidadId = oportunidadRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function crear(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, ...body });
  }

  async function detalle(id: number) {
    const res = await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${id}`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    return res.body;
  }

  it("redondea cada línea a centavos con la mitad hacia arriba (0.5 × 2.01 = 1.01; 1.5 × 0.03 = 0.05)", async () => {
    const res = await crear({
      partidas: [
        { descripcion: "Línea 1", cantidad: 0.5, precioUnitario: 2.01 },
        { descripcion: "Línea 2", cantidad: 1.5, precioUnitario: 0.03 }
      ]
    });
    expect(res.status).toBe(201);

    const cotizacion = await detalle(res.body.id);
    expect(cotizacion.partidas.map((p: { importe: string }) => p.importe)).toEqual(["1.01", "0.05"]);
    expect(cotizacion.subtotal).toBe("1.06");
    expect(cotizacion.total).toBe("1.06");
  });

  it("total = subtotal - descuento + impuestos, exacto al centavo", async () => {
    const res = await crear({
      descuento: 10.5,
      impuestos: 16.08,
      partidas: [{ descripcion: "Servicio", cantidad: 2.5, precioUnitario: 100.11 }]
    });
    expect(res.status).toBe(201);

    const cotizacion = await detalle(res.body.id);
    // 2.5 × 100.11 = 250.275 -> 250.28; 250.28 - 10.50 + 16.08 = 255.86.
    expect(cotizacion.subtotal).toBe("250.28");
    expect(cotizacion.descuento).toBe("10.50");
    expect(cotizacion.total).toBe("255.86");
  });

  it("montos grandes sin perder centavos (la multiplicación no cabe en un número de JavaScript)", async () => {
    const res = await crear({ partidas: [{ descripcion: "Grande", cantidad: 999_999.99, precioUnitario: 9_999.99 }] });
    expect(res.status).toBe(201);
    // 999,999.99 × 9,999.99 = 9,999,989,900.0001 -> 9,999,989,900.00
    expect((await detalle(res.body.id)).subtotal).toBe("9999989900.00");
  });

  it("rechaza (400) más de 2 decimales en precio, cantidad, descuento o impuestos", async () => {
    const partida = { descripcion: "Partida", cantidad: 1, precioUnitario: 1 };
    expect((await crear({ partidas: [{ ...partida, precioUnitario: 0.333 }] })).status).toBe(400);
    expect((await crear({ partidas: [{ ...partida, cantidad: 1.125 }] })).status).toBe(400);
    expect((await crear({ descuento: 0.001, partidas: [partida] })).status).toBe(400);
    expect((await crear({ impuestos: 0.005, partidas: [partida] })).status).toBe(400);
  });

  it("el descuento no puede ser mayor que el subtotal, aunque los impuestos lo cubran (400)", async () => {
    const res = await crear({ descuento: 110, impuestos: 16, partidas: [{ descripcion: "Partida", cantidad: 1, precioUnitario: 100 }] });
    expect(res.status).toBe(400);
  });
});
