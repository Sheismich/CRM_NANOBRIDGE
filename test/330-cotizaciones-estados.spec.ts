import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Estados de las cotizaciones (D2 del plan de fixes, 2-oct-2026).
describe("cotizaciones: aceptada, una por oportunidad y oportunidad abierta", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;
  const partidas = [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 100 }];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const empresa = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa Cotizaciones D2 ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `cot.d2.${randomUUID()}@test.local` }] });
    empresaId = empresa.body.id as number;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function oportunidad() {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Oportunidad D2 ${randomUUID()}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function cotizacion(oportunidadId: number) {
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, partidas });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  const estado = (id: number, nuevo: string) => api().patch(`/api/v1/cotizaciones/${id}/estado`).set("Cookie", adminCookie).send({ estado: nuevo });
  const version = (id: number) => api().post(`/api/v1/cotizaciones/${id}/version`).set("Cookie", adminCookie).send({ partidas });

  async function aceptada(oportunidadId: number) {
    const id = await cotizacion(oportunidadId);
    expect((await estado(id, "enviada")).status).toBe(200);
    expect((await estado(id, "aceptada")).status).toBe(200);
    return id;
  }

  it("una aceptada no se versiona (perdería el trato cerrado): 409 con code; una rechazada sí", async () => {
    const op = await oportunidad();
    const res = await version(await aceptada(op));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COTIZACION_ACEPTADA");

    const rechazada = await cotizacion(op);
    expect((await estado(rechazada, "enviada")).status).toBe(200);
    expect((await estado(rechazada, "rechazada")).status).toBe(200);
    expect((await version(rechazada)).status).toBe(201);
  });

  it("solo una aceptada por oportunidad, también si se aceptan dos al mismo tiempo", async () => {
    const op = await oportunidad();
    await aceptada(op);
    const otra = await cotizacion(op);
    expect((await estado(otra, "enviada")).status).toBe(200);
    const res = await estado(otra, "aceptada");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("YA_HAY_COTIZACION_ACEPTADA");

    const op2 = await oportunidad();
    const [a, b] = [await cotizacion(op2), await cotizacion(op2)];
    expect((await estado(a, "enviada")).status).toBe(200);
    expect((await estado(b, "enviada")).status).toBe(200);
    const resultados = await Promise.all([estado(a, "aceptada"), estado(b, "aceptada")]);
    expect(resultados.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it("con la oportunidad cerrada no se versiona, envía ni acepta; rechazar sí", async () => {
    const op = await oportunidad();
    const borrador = await cotizacion(op);
    const enviada = await cotizacion(op);
    expect((await estado(enviada, "enviada")).status).toBe(200);
    expect((await api().patch(`/api/v1/oportunidades/${op}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "perdida", motivoPerdidaClave: "sin_presupuesto" })).status).toBe(200);

    for (const res of [await version(borrador), await estado(borrador, "enviada"), await estado(enviada, "aceptada")]) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("OPORTUNIDAD_CERRADA");
    }
    expect((await estado(enviada, "rechazada")).status).toBe(200);
  });
});
