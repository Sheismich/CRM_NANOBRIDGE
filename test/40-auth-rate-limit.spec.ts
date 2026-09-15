import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { SEED_ADMIN } from "./support/seed.js";

// Cubre RateLimitGuard aplicado a /auth/login (max 10 / 15 min por IP) --
// ver auth.controller.ts. Archivo aparte de 00-auth.spec.ts a propósito:
// no debe compartir cuenta ni supuestos con el resto de la suite, solo
// necesita que /auth/login exista y responda 401 ante credenciales
// incorrectas (no necesita una cuenta real para golpear el límite).
describe("RateLimitGuard en /auth/login", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("responde 401 en los primeros 10 intentos y 429 a partir del 11 (misma IP)", async () => {
    const intento = () => request(app.getHttpServer()).post("/api/v1/auth/login").send({ correo: "nadie@test.local", password: "password_incorrecta_1" });

    for (let i = 0; i < 10; i++) {
      const res = await intento();
      expect(res.status).toBe(401);
    }

    const bloqueado = await intento();
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.headers["retry-after"]).toBeDefined();
  });

  it("/auth/bootstrap tiene su propio límite (max 5 / 15 min), independiente del de login", async () => {
    // Manda SIEMPRE las credenciales de SEED_ADMIN, nunca un correo
    // inventado: bootstrap() solo puede crear una cuenta en TODA la
    // corrida (comparte el mismo contenedor MySQL con el resto de los
    // archivos -- ver global-setup.ts), así que si esta prueba fuera la
    // primera en ejecutarse y usara un correo distinto, esa cuenta
    // "random" se quedaría como la única del sistema y ensureSeedAdmin()
    // de CUALQUIER otro archivo tronaría al no encontrar admin.semilla@...
    // (pasó de verdad en este mismo cambio: hallazgo en vivo, 15-sep-2026).
    // No importa si cada intento da 201 o 409 -- el guard cuenta
    // peticiones, no resultados. Solo interesa que el 6to intento sea 429.
    const intento = () => request(app.getHttpServer()).post("/api/v1/auth/bootstrap").send(SEED_ADMIN);

    for (let i = 0; i < 5; i++) {
      const res = await intento();
      expect([201, 409]).toContain(res.status);
    }

    const bloqueado = await intento();
    expect(bloqueado.status).toBe(429);
  });
});
