import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";

// Archivo aparte de 40-auth-rate-limit.spec.ts a propósito: ese archivo ya
// agota el cupo de login mandando peticiones una por una (await secuencial)
// -- esta prueba necesita partir de un contador en cero para poder medir
// qué pasa cuando llegan varias A LA VEZ.
//
// Cubre el hallazgo de code-review del 15-sep-2026 (confirmado por dos
// agentes de revisión independientes): la versión original de
// RateLimitGuard solo contaba el intento DESPUÉS de esperar a la consulta
// a MySQL + verificar la contraseña con argon2 (dentro de un catch), así
// que una ráfaga de peticiones concurrentes podía pasar todas el chequeo
// ANTES de que cualquiera alcanzara a contar -- el límite se saltaba por
// completo con solo mandar varias peticiones a la vez en vez de una por
// una. El arreglo cuenta de forma SÍNCRONA en canActivate(), antes de
// cualquier await de la ruta.
describe("RateLimitGuard bajo concurrencia real", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("15 intentos de login incorrectos EN PARALELO no se saltan el límite (max 10)", async () => {
    const intento = () => request(app.getHttpServer()).post("/api/v1/auth/login").send({ correo: "nadie.concurrente@test.local", password: "password_incorrecta_1" });

    const resultados = await Promise.all(Array.from({ length: 15 }, () => intento()));
    const noLimitados = resultados.filter((r) => r.status === 401).length;
    const limitados = resultados.filter((r) => r.status === 429).length;

    // Con el bug original, las 15 pasaban como 401 (0 limitados) porque
    // ninguna alcanzaba a contar antes de que las demás ya hubieran
    // pasado el chequeo.
    expect(noLimitados).toBeLessThanOrEqual(10);
    expect(limitados).toBeGreaterThan(0);
    expect(noLimitados + limitados).toBe(15);
  });
});
