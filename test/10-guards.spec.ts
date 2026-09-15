import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin, loginAs } from "./support/seed.js";

const AGENTE = { nombre: "Agente De Prueba", correo: "agente.guards@test.local", password: "password_agente_1", rol: "agente" as const };

describe("RolesGuard (sesión) y ApiKeyGuard (n8n)", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const crear = await request(app.getHttpServer()).post("/api/v1/usuarios").set("Cookie", adminCookie).send(AGENTE);
    expect(crear.status).toBe(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it("un rol sin permiso recibe 403 de RolesGuard (agente contra GET /usuarios)", async () => {
    const agenteCookie = await loginAs(app, AGENTE.correo, AGENTE.password);
    const res = await request(app.getHttpServer()).get("/api/v1/usuarios").set("Cookie", agenteCookie);
    expect(res.status).toBe(403);
  });

  it("un rol con permiso (administrador) sí puede listar usuarios", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/usuarios").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  });

  it("ApiKeyGuard responde 401 sin X-API-Key", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/automatizacion/parametros");
    expect(res.status).toBe(401);
  });

  it("ApiKeyGuard responde 401 con una X-API-Key incorrecta", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/automatizacion/parametros").set("X-API-Key", "llave_incorrecta");
    expect(res.status).toBe(401);
  });

  it("ApiKeyGuard deja pasar con la X-API-Key correcta (CRM_CALLBACK_API_KEY)", async () => {
    // Mismo valor fijado en test/setup/setup-env.ts.
    const res = await request(app.getHttpServer()).get("/api/v1/automatizacion/parametros").set("X-API-Key", "test_crm_callback_api_key_0001");
    expect(res.status).toBe(200);
  });

  it("una cookie de sesión válida NO sirve como X-API-Key (superficies separadas)", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/automatizacion/parametros").set("Cookie", adminCookie);
    expect(res.status).toBe(401);
  });
});
