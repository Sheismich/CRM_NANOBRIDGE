import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, prospectos, tareas } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// POST /tareas (C2 del plan de fixes, 2-oct-2026). Antes no revisaba nada:
// un agente podía crearle tareas a otro, colgarlas de empresas ajenas o de
// un contacto de otra empresa, y crear seguimientos a una persona dada de
// baja.
describe("alta y cierre de tareas: lo que se revisa", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());
  const crear = (cookie: string[], body: Record<string, unknown>) => api().post("/api/v1/tareas").set("Cookie", cookie).send({ titulo: "Llamar", ...body });
  const filaDe = async (id: number) => (await db.select().from(tareas).where(eq(tareas.id, id)))[0]!;

  async function nuevoAgente() {
    const cookie = await crearAgente(app, adminCookie, `tareas.alta.${randomUUID()}@test.local`);
    return { cookie, id: (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number };
  }

  async function empresaDe(cookie: string[]) {
    const res = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal: `Empresa Tareas ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `tareas.alta.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    const [contacto] = await db.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, res.body.id));
    return { empresaId: res.body.id as number, contactoId: contacto!.id };
  }

  async function prospectoDeN8n() {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Tareas N8n ${randomUUID()}` }, contacto: { nombre: "Persona", correo: `tareas.n8n.${randomUUID()}@test.local` } });
    expect(res.status).toBe(201);
    const [fila] = await db.select({ contactoId: prospectos.contactoId, empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, res.body.id));
    return { prospectoId: res.body.id as number, ...fila! };
  }

  it("un agente siempre se crea la tarea a sí mismo, aunque mande otro responsable", async () => {
    const agente = await nuevoAgente();
    const res = await crear(agente.cookie, { responsableId: adminId });
    expect(res.status).toBe(201);
    expect((await filaDe(res.body.id)).responsableId).toBe(agente.id);
  });

  it("un agente solo cuelga tareas de sus empresas: la ajena responde 404", async () => {
    const agente = await nuevoAgente();
    const suya = await empresaDe(agente.cookie);
    const ajena = await empresaDe(adminCookie);
    expect((await crear(agente.cookie, { responsableId: agente.id, empresaId: suya.empresaId })).status).toBe(201);
    expect((await crear(agente.cookie, { responsableId: agente.id, empresaId: ajena.empresaId })).status).toBe(404);
    expect((await crear(agente.cookie, { responsableId: agente.id, contactoId: ajena.contactoId })).status).toBe(404);
  });

  it("el contacto tiene que ser de la empresa (también para el admin)", async () => {
    const una = await empresaDe(adminCookie);
    const otra = await empresaDe(adminCookie);
    expect((await crear(adminCookie, { responsableId: adminId, empresaId: una.empresaId, contactoId: otra.contactoId })).status).toBe(404);
  });

  it("con solo el prospecto, la tarea toma su contacto y su empresa (y sale en la ficha)", async () => {
    const p = await prospectoDeN8n();
    const res = await crear(adminCookie, { responsableId: adminId, prospectoId: p.prospectoId });
    expect(res.status).toBe(201);
    expect(await filaDe(res.body.id)).toMatchObject({ prospectoId: p.prospectoId, contactoId: p.contactoId, empresaId: p.empresaId });
  });

  it("prospecto y contacto que no coinciden: 400", async () => {
    const p = await prospectoDeN8n();
    const otra = await empresaDe(adminCookie);
    expect((await crear(adminCookie, { responsableId: adminId, prospectoId: p.prospectoId, contactoId: otra.contactoId })).status).toBe(400);
  });

  it("no se crea un seguimiento a una persona dada de baja (409 con code); otra clase de tarea sí", async () => {
    const p = await prospectoDeN8n();
    await db.update(prospectos).set({ estado: "baja" }).where(eq(prospectos.id, p.prospectoId));

    const seguimiento = await crear(adminCookie, { responsableId: adminId, tipo: "seguimiento", prospectoId: p.prospectoId });
    expect(seguimiento.status).toBe(409);
    expect(seguimiento.body.code).toBe("PERSONA_EN_BAJA");
    // Por contacto también (otro prospecto de la misma persona no la saca de la baja).
    expect((await crear(adminCookie, { responsableId: adminId, contactoId: p.contactoId })).status).toBe(409);
    expect((await crear(adminCookie, { responsableId: adminId, tipo: "otro", prospectoId: p.prospectoId })).status).toBe(201);
  });

  it("el responsable tiene que ser un usuario activo: 409", async () => {
    const agente = await nuevoAgente();
    expect((await api().delete(`/api/v1/usuarios/${agente.id}`).set("Cookie", adminCookie)).status).toBe(204);
    expect((await crear(adminCookie, { responsableId: agente.id })).status).toBe(409);
  });
});
