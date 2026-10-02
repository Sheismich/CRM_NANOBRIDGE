import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Oportunidades (C3 del plan de fixes, 2-oct-2026): un agente podía crear
// una oportunidad en cualquier empresa activa, aunque no fuera suya, y un
// valor estimado más grande que la columna (DECIMAL(12,2)) tronaba con 500.
describe("oportunidades: empresa del agente y tope del valor estimado", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function empresaDe(cookie: string[]) {
    const res = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal: `Empresa Oportunidades ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `op.agente.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  const crear = (cookie: string[], body: Record<string, unknown>) => api().post("/api/v1/oportunidades").set("Cookie", cookie).send({ titulo: "Oportunidad", ...body });

  it("un agente crea oportunidades en sus empresas; en una ajena, 404", async () => {
    const agente = await crearAgente(app, adminCookie, `op.agente.${randomUUID()}@test.local`);
    expect((await crear(agente, { empresaId: await empresaDe(agente) })).status).toBe(201);
    expect((await crear(agente, { empresaId: await empresaDe(adminCookie) })).status).toBe(404);
  });

  it("el valor estimado no puede pasar de lo que cabe en la columna: 400, no 500", async () => {
    const empresaId = await empresaDe(adminCookie);
    expect((await crear(adminCookie, { empresaId, valorEstimado: 9_999_999_999.99 })).status).toBe(201);
    expect((await crear(adminCookie, { empresaId, valorEstimado: 10_000_000_000 })).status).toBe(400);
  });

  // Las métricas diarias guardan la SUMA del pipeline en una columna que era
  // igual de chica que la de una sola oportunidad (DECIMAL(12,2)): dos
  // oportunidades grandes la desbordaban y el trabajo diario de métricas
  // (PT5) respondía 500 todos los días. Migración 027.
  it("el trabajo de métricas aguanta un pipeline más grande que el tope de una oportunidad", async () => {
    const empresaId = await empresaDe(adminCookie);
    expect((await crear(adminCookie, { empresaId, valorEstimado: 9_999_999_999.99 })).status).toBe(201);
    expect((await crear(adminCookie, { empresaId, valorEstimado: 9_999_999_999.99 })).status).toBe(201);
    const res = await api().post("/api/v1/automatizacion/jobs/metricas-diarias").set("X-API-Key", API_KEY).send({});
    expect(res.status).toBe(200);
  });
});
