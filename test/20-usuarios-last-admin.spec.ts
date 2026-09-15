import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";

// Cubre la regla de negocio "no dejar el sistema sin al menos un
// administrador activo" (usuarios.service.ts: assertNoEsUltimoAdministrador)
// y el arreglo real de interbloqueo (lockAdministradorRole, orden fijo de
// locks) que antes se verificaba a mano con curl concurrente cada sesión.
describe("usuarios: invariante de último administrador", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("no se puede desactivar la propia cuenta (self-lock, aunque haya otros administradores)", async () => {
    const meRes = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    const res = await request(app.getHttpServer()).delete(`/api/v1/usuarios/${meRes.body.id}`).set("Cookie", adminCookie);
    expect(res.status).toBe(409);
  });

  it("degradar al ÚLTIMO administrador activo (a sí mismo) se rechaza con 409", async () => {
    const meRes = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    // En este punto SEED_ADMIN es el único administrador activo que existe
    // en toda la corrida (test/00-auth.spec.ts es el único bootstrap).
    const res = await request(app.getHttpServer()).patch(`/api/v1/usuarios/${meRes.body.id}`).set("Cookie", adminCookie).send({ rol: "agente" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/al menos un administrador/i);
  });

  it("SÍ se puede degradar a un administrador cuando queda otro activo, y luego el último queda protegido", async () => {
    const crearB = await request(app.getHttpServer())
      .post("/api/v1/usuarios")
      .set("Cookie", adminCookie)
      .send({ nombre: "Admin B", correo: "admin.b@test.local", password: "password_admin_b_1", rol: "administrador" });
    expect(crearB.status).toBe(201);
    const idB = crearB.body.id;

    // Con SEED_ADMIN + B como administradores activos, degradar a B es
    // válido: SEED_ADMIN sigue como administrador.
    const degradarB = await request(app.getHttpServer()).patch(`/api/v1/usuarios/${idB}`).set("Cookie", adminCookie).send({ rol: "agente" });
    expect(degradarB.status).toBe(200);
    expect(degradarB.body.rol).toBe("agente");

    // Ahora SEED_ADMIN vuelve a ser el único administrador: degradarse a sí
    // mismo debe seguir bloqueado.
    const meRes = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    const degradarSeed = await request(app.getHttpServer()).patch(`/api/v1/usuarios/${meRes.body.id}`).set("Cookie", adminCookie).send({ rol: "agente" });
    expect(degradarSeed.status).toBe(409);
  });

  it("dos PATCH concurrentes sobre DOS administradores distintos no producen deadlock (orden fijo de locks)", async () => {
    const crearC = await request(app.getHttpServer())
      .post("/api/v1/usuarios")
      .set("Cookie", adminCookie)
      .send({ nombre: "Admin C", correo: "admin.c@test.local", password: "password_admin_c_1", rol: "administrador" });
    const crearD = await request(app.getHttpServer())
      .post("/api/v1/usuarios")
      .set("Cookie", adminCookie)
      .send({ nombre: "Admin D", correo: "admin.d@test.local", password: "password_admin_d_1", rol: "administrador" });
    expect(crearC.status).toBe(201);
    expect(crearD.status).toBe(201);

    // SEED_ADMIN, C y D activos como administradores -- degradar a C y a D
    // al mismo tiempo es válido en ambos casos (SEED_ADMIN sigue quedando).
    // Antes del arreglo de code review (14-sep-2026), dos transacciones
    // concurrentes como estas podían chocar en un ER_LOCK_DEADLOCK real
    // (500 sin manejar) en vez de resolver limpio.
    const [resC, resD] = await Promise.all([
      request(app.getHttpServer()).patch(`/api/v1/usuarios/${crearC.body.id}`).set("Cookie", adminCookie).send({ rol: "agente" }),
      request(app.getHttpServer()).patch(`/api/v1/usuarios/${crearD.body.id}`).set("Cookie", adminCookie).send({ rol: "agente" })
    ]);

    expect(resC.status).toBe(200);
    expect(resD.status).toBe(200);
  });
});
