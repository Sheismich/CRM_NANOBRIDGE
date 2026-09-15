import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";

// Archivo APARTE de 40-auth-rate-limit.spec.ts a propósito: ese archivo ya
// agota el límite de /auth/login a propósito (10 fallidos -> 429) sobre su
// propia instancia de app/guard, así que no sirve para probar "un login
// CORRECTO no cuenta" -- necesita partir de un contador en cero, y Vitest
// aísla el registro de módulos por archivo (cada archivo reevalúa
// auth.controller.ts, incluida la instancia de RateLimitGuard que vive ahí
// como constante de módulo).
//
// Cubre el arreglo de code-review del 15-sep-2026: antes, CUALQUIER
// petición a /auth/login contaba para el límite (éxito o no), así que
// varios usuarios legítimos detrás de la misma IP/NAT (oficina compartida)
// podían bloquearse entre sí sin que nadie hubiera fallado nunca.
describe("login correcto no cuenta para el límite de intentos", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("más de 10 logins CORRECTOS seguidos (misma IP) nunca disparan el 429", async () => {
    // El límite real es max:10 -- 15 intentos correctos de sobra para
    // probar que un login exitoso no suma al contador (con el bug
    // original, el intento #11 ya habría sido 429).
    for (let i = 0; i < 15; i++) {
      const res = await request(app.getHttpServer()).post("/api/v1/auth/login").send({ correo: SEED_ADMIN.correo, password: SEED_ADMIN.password });
      expect(res.status).toBe(200);
    }
  });
});
