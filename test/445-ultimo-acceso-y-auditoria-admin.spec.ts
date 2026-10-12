import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { usuarios } from "../src/database/schema.js";

// Administración del rediseño (12-oct-2026; punto 37): "Último acceso: hoy,
// 09:45" = la última vez que la persona usó el CRM, no cuándo inició sesión
// (una sesión dura días). Se guarda a lo más una vez cada 5 minutos por
// usuario para no escribir en cada petición (condición de Fabián).
// Y /auditoria pasa a ser solo del administrador (antes también supervisor).
describe("administración: último acceso y auditoría solo admin", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function agenteNuevo() {
    const correo = `acceso.${randomUUID()}@test.local`;
    const cookie = await crearAgente(app, adminCookie, correo);
    const id = (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number;
    return { correo, cookie, id };
  }

  async function ultimoAcceso(id: number) {
    const [fila] = await db.select({ en: usuarios.ultimoAccesoEn }).from(usuarios).where(eq(usuarios.id, id));
    return fila?.en ?? null;
  }

  it("iniciar sesión pone el último acceso", async () => {
    const correo = `acceso.${randomUUID()}@test.local`;
    const crear = await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: "Sin entrar", correo, password: "password_agente_1", rol: "agente" });
    expect(crear.status).toBe(201);
    expect(await ultimoAcceso(crear.body.id)).toBeNull();

    const antes = Date.now();
    await loginAs(app, correo, "password_agente_1");
    const en = await ultimoAcceso(crear.body.id);
    expect(en).not.toBeNull();
    // MySQL guarda al segundo.
    expect(en!.getTime()).toBeGreaterThanOrEqual(antes - 2_000);
  });

  it("usar el CRM lo actualiza, pero a lo más una vez cada 5 minutos", async () => {
    const agente = await agenteNuevo();

    // Hace 3 minutos: una petición nueva NO lo mueve.
    const hace3 = new Date(Math.floor((Date.now() - 3 * 60_000) / 1000) * 1000);
    await db.update(usuarios).set({ ultimoAccesoEn: hace3 }).where(eq(usuarios.id, agente.id));
    expect((await api().get("/api/v1/tareas").set("Cookie", agente.cookie)).status).toBe(200);
    expect((await ultimoAcceso(agente.id))!.getTime()).toBe(hace3.getTime());

    // Hace 6 minutos: sí se actualiza a ahora.
    const hace6 = new Date(Date.now() - 6 * 60_000);
    await db.update(usuarios).set({ ultimoAccesoEn: hace6 }).where(eq(usuarios.id, agente.id));
    const antes = Date.now();
    expect((await api().get("/api/v1/tareas").set("Cookie", agente.cookie)).status).toBe(200);
    expect((await ultimoAcceso(agente.id))!.getTime()).toBeGreaterThanOrEqual(antes - 2_000);
  });

  it("la lista y la ficha de usuarios traen el último acceso", async () => {
    const agente = await agenteNuevo();
    const lista = await api().get("/api/v1/usuarios").set("Cookie", adminCookie).query({ limit: 100, rol: "agente" });
    expect(lista.status).toBe(200);
    const fila = lista.body.data.find((u: { id: number }) => u.id === agente.id);
    expect(fila.ultimo_acceso_en).not.toBeNull();

    const ficha = await api().get(`/api/v1/usuarios/${agente.id}`).set("Cookie", adminCookie);
    expect(ficha.body.ultimo_acceso_en).not.toBeNull();
  });

  it("/auditoria es solo del administrador: un supervisor recibe 403", async () => {
    const correo = `sup.auditoria.${randomUUID()}@test.local`;
    expect((await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: "Supervisora", correo, password: "password_sup_1", rol: "supervisor" })).status).toBe(201);
    const supCookie = await loginAs(app, correo, "password_sup_1");

    expect((await api().get("/api/v1/auditoria").set("Cookie", supCookie)).status).toBe(403);
    expect((await api().get("/api/v1/auditoria").set("Cookie", adminCookie)).status).toBe(200);
  });
});
