import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";

// Cubre CotizacionesService.calcular() (cotizaciones.service.ts): cada
// importe se redondea a 2 decimales POR LÍNEA antes de sumar, no se suma en
// crudo y se redondea una sola vez al final -- ver el comentario ahí
// (hallazgo de code review, 11-sep-2026). Este caso concreto distingue las
// dos estrategias por un centavo real:
//   0.333 -> redondea a 0.33 (línea 1 y 2), 0.334 -> redondea a 0.33 (línea 3)
//   sumando ya redondeado: 0.33 + 0.33 + 0.33 = 0.99  <- lo que debe pasar
//   sumando en crudo y redondeando al final: 0.333+0.333+0.334 = 1.000 -> "1.00"
// Si alguien "simplifica" calcular() a sumar primero y redondear después,
// esta prueba detecta el centavo perdido.
describe("cotizaciones: redondeo de montos", () => {
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

  it("redondea cada línea antes de sumar, en vez de sumar en crudo y redondear al final", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cotizaciones")
      .set("Cookie", adminCookie)
      .send({
        empresaId,
        oportunidadId,
        partidas: [
          { descripcion: "Línea 1", cantidad: 1, precioUnitario: 0.333 },
          { descripcion: "Línea 2", cantidad: 1, precioUnitario: 0.333 },
          { descripcion: "Línea 3", cantidad: 1, precioUnitario: 0.334 }
        ]
      });
    expect(res.status).toBe(201);

    const detalle = await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${res.body.id}`).set("Cookie", adminCookie);
    expect(detalle.status).toBe(200);
    expect(detalle.body.subtotal).toBe("0.99");
    expect(detalle.body.total).toBe("0.99");
    expect(detalle.body.partidas.map((p: { importe: string }) => p.importe)).toEqual(["0.33", "0.33", "0.33"]);
  });

  it("total = subtotal - descuento + impuestos, con descuento e impuestos reales", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/cotizaciones")
      .set("Cookie", adminCookie)
      .send({
        empresaId,
        oportunidadId,
        descuento: 10.5,
        impuestos: 16.08,
        partidas: [{ descripcion: "Servicio", cantidad: 2.5, precioUnitario: 100.11 }]
      });
    expect(res.status).toBe(201);

    const detalle = await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${res.body.id}`).set("Cookie", adminCookie);
    // 2.5 * 100.11 = 250.275 -> redondeado a 2 decimales: 250.28 (o 250.27,
    // según el modo de redondeo del motor -- lo que importa es que total
    // sea EXACTAMENTE subtotal - descuento + impuestos con esos mismos
    // 2 decimales, no que adivinemos el redondeo de la línea).
    const subtotal = Number(detalle.body.subtotal);
    const total = Number(detalle.body.total);
    expect(total).toBeCloseTo(subtotal - 10.5 + 16.08, 2);
  });
});
