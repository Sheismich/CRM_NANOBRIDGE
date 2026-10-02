import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { env } from "../src/config/env.js";

// Errores del CLIENTE que salían como 500 ("error del servidor") y
// ensuciaban los logs (B3 del plan de fixes, 2-oct-2026): JSON mal formado,
// body demasiado grande, multipart roto y una cookie de sesión con forma
// rara. Deben responder 4xx con el formato de siempre ({ error, message }).
describe("errores del cliente responden 4xx, no 500", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const api = () => request(app.getHttpServer());

  it("JSON mal formado: 400", async () => {
    const res = await api().post("/api/v1/auth/login").set("Content-Type", "application/json").send('{"correo": "a@b.c",');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "request_error" });
  });

  it("body de más de 1 MB: 413", async () => {
    const res = await api().post("/api/v1/auth/login").set("Content-Type", "application/json").send(JSON.stringify({ correo: "a@b.c", password: "x".repeat(1_100_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ error: "request_error" });
  });

  it("multipart con el campo equivocado: 400", async () => {
    const res = await api().post("/api/v1/prospectos/importaciones").set("Cookie", adminCookie).attach("otro_campo", Buffer.from("a,b\n1,2"), "x.csv");
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "request_error" });
  });

  it("cookie de sesión que no es texto (j:{...}): 401, no 500", async () => {
    const me = await api().get("/api/v1/auth/me").set("Cookie", `${env.SESSION_COOKIE_NAME}=j%3A%7B%7D`);
    expect(me.status).toBe(401);
    const logout = await api().post("/api/v1/auth/logout").set("Cookie", `${env.SESSION_COOKIE_NAME}=j%3A%7B%7D`);
    expect(logout.status).toBe(204);
  });
});
