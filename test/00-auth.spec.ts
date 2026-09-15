import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";

describe("POST /auth/bootstrap, /auth/login y SessionAuthGuard", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    // Garantiza que la cuenta semilla exista, la haya creado este archivo o
    // cualquier otro que corriera antes -- Vitest no garantiza el orden de
    // ejecución entre archivos (ver comentario en test/support/seed.ts).
    await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("una vez que existe la cuenta inicial, un segundo bootstrap se rechaza con 409", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/auth/bootstrap")
      .send({ nombre: "Otro Admin", correo: "otro@test.local", password: "otra_password_1" });
    expect(res.status).toBe(409);
  });

  it("login con contraseña incorrecta responde 401, sin filtrar si el correo existe", async () => {
    const conCorreoReal = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ correo: SEED_ADMIN.correo, password: "password_incorrecta_1" });
    const conCorreoInexistente = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ correo: "no.existe@test.local", password: "password_incorrecta_1" });
    expect(conCorreoReal.status).toBe(401);
    expect(conCorreoInexistente.status).toBe(401);
  });

  it("GET /auth/me sin cookie de sesión responde 401 (SessionAuthGuard)", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("login correcto entrega una cookie válida para /auth/me", async () => {
    const loginRes = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ correo: SEED_ADMIN.correo, password: SEED_ADMIN.password });
    expect(loginRes.status).toBe(200);

    const meRes = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", loginRes.headers["set-cookie"]);
    expect(meRes.status).toBe(200);
    expect(meRes.body.correo).toBe(SEED_ADMIN.correo);
  });
});
