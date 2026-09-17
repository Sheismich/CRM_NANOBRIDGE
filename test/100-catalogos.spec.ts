import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";

describe("catalogos (sesión CRM)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("sin sesión responde 401", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/catalogos");
    expect(res.status).toBe(401);
  });

  it("con sesión devuelve los catálogos ENUM, idénticos a GET /automatizacion/catalogos", async () => {
    const [crm, automatizacion] = await Promise.all([
      request(app.getHttpServer()).get("/api/v1/catalogos").set("Cookie", adminCookie),
      request(app.getHttpServer()).get("/api/v1/automatizacion/catalogos").set("X-API-Key", "test_crm_callback_api_key_0001")
    ]);

    expect(crm.status).toBe(200);
    expect(crm.body).toEqual(automatizacion.body);
    expect(crm.body.tamano_empresa).toEqual(["micro", "pequena", "mediana", "grande"]);
    expect(Array.isArray(crm.body.tarea_tipo)).toBe(true);
    expect(crm.body.tarea_tipo.length).toBeGreaterThan(0);
  });

  it("un agente (sin rol de administrador/supervisor) también puede leer los catálogos", async () => {
    const agenteCookie = await crearAgente(app, adminCookie, `agente.catalogos.${Date.now()}@test.local`);
    const res = await request(app.getHttpServer()).get("/api/v1/catalogos").set("Cookie", agenteCookie);
    expect(res.status).toBe(200);
    expect(res.body.tamano_empresa).toBeDefined();
  });
});
