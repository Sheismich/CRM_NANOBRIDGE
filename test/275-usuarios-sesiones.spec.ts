import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, tareas } from "../src/database/schema.js";

// Sesiones y usuarios (B2 del plan de fixes, 2-oct-2026):
// - cambiar la contraseña de alguien no cerraba sus sesiones: una cookie
//   robada seguía sirviendo hasta 12 horas;
// - desactivar era para siempre (no había forma de reactivar);
// - las tareas abiertas de un usuario desactivado se quedaban a su nombre y
//   nadie las veía en "Sin asignar".
describe("usuarios: sesiones, desactivar y reactivar", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function agenteNuevo() {
    const correo = `usuario.${randomUUID()}@test.local`;
    const cookie = await crearAgente(app, adminCookie, correo, "password_original_1");
    const me = await api().get("/api/v1/auth/me").set("Cookie", cookie);
    return { correo, cookie, id: me.body.id as number };
  }

  it("cambiar la contraseña de alguien cierra sus sesiones abiertas", async () => {
    const agente = await agenteNuevo();
    expect((await api().get("/api/v1/auth/me").set("Cookie", agente.cookie)).status).toBe(200);

    const res = await api().patch(`/api/v1/usuarios/${agente.id}`).set("Cookie", adminCookie).send({ password: "password_nueva_123" });
    expect(res.status).toBe(200);

    expect((await api().get("/api/v1/auth/me").set("Cookie", agente.cookie)).status).toBe(401);
    // Con la contraseña nueva vuelve a entrar.
    expect(await loginAs(app, agente.correo, "password_nueva_123")).toBeDefined();
  });

  it("cambiar solo el nombre NO cierra sus sesiones", async () => {
    const agente = await agenteNuevo();
    expect((await api().patch(`/api/v1/usuarios/${agente.id}`).set("Cookie", adminCookie).send({ nombre: "Nombre Cambiado" })).status).toBe(200);
    expect((await api().get("/api/v1/auth/me").set("Cookie", agente.cookie)).status).toBe(200);
  });

  it("al desactivar a alguien, sus tareas abiertas pasan a 'Sin asignar' (las cerradas no se tocan)", async () => {
    const agente = await agenteNuevo();
    const abierta = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: "Llamar al cliente", responsableId: agente.id });
    const cerrada = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: "Ya hecha", responsableId: agente.id });
    expect((await api().patch(`/api/v1/tareas/${cerrada.body.id}/cerrar`).set("Cookie", adminCookie).send({ resultado: "listo" })).status).toBe(200);

    expect((await api().delete(`/api/v1/usuarios/${agente.id}`).set("Cookie", adminCookie)).status).toBe(204);

    const [fila] = await db.select({ responsableId: tareas.responsableId }).from(tareas).where(eq(tareas.id, abierta.body.id));
    expect(fila!.responsableId).toBeNull();
    const [filaCerrada] = await db.select({ responsableId: tareas.responsableId }).from(tareas).where(eq(tareas.id, cerrada.body.id));
    expect(filaCerrada!.responsableId).toBe(agente.id);

    const sinAsignar = await api().get("/api/v1/tareas").set("Cookie", adminCookie).query({ sinAsignar: "true", limit: 100 });
    expect((sinAsignar.body.data as { id: number }[]).some((t) => t.id === abierta.body.id)).toBe(true);

    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "usuario"), eq(auditoria.entidadId, agente.id), eq(auditoria.accion, "desactivar")));
    expect((audit!.despues as { tareas_liberadas: number[] }).tareas_liberadas).toEqual([abierta.body.id]);
  });

  it("un usuario desactivado se puede reactivar y vuelve a entrar con su contraseña", async () => {
    const agente = await agenteNuevo();
    expect((await api().delete(`/api/v1/usuarios/${agente.id}`).set("Cookie", adminCookie)).status).toBe(204);
    expect((await api().post("/api/v1/auth/login").send({ correo: agente.correo, password: "password_original_1" })).status).toBe(401);

    const res = await api().post(`/api/v1/usuarios/${agente.id}/reactivar`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: agente.id, activo: true });
    expect(await loginAs(app, agente.correo, "password_original_1")).toBeDefined();

    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "usuario"), eq(auditoria.entidadId, agente.id), eq(auditoria.accion, "reactivar")));
    expect(audit).toBeDefined();
  });

  it("reactivar a alguien activo: 409; un agente no puede reactivar: 403; un id que no existe: 404", async () => {
    const agente = await agenteNuevo();
    expect((await api().post(`/api/v1/usuarios/${agente.id}/reactivar`).set("Cookie", adminCookie)).status).toBe(409);
    expect((await api().post(`/api/v1/usuarios/${agente.id}/reactivar`).set("Cookie", agente.cookie)).status).toBe(403);
    expect((await api().post("/api/v1/usuarios/999999999/reactivar").set("Cookie", adminCookie)).status).toBe(404);
  });
});
