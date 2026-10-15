import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Ficha de empresa (revisión de la vista previa, 15-oct-2026): la tarjeta de
// Tareas pide las tareas de UNA empresa, y el encabezado enseña en qué va su
// prospección, igual que la lista de Empresas.
describe("ficha de empresa: tareas de la empresa y prospección", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let adminId: number;
  let agenteId: number;
  let empresaA: number;
  let empresaB: number;
  let prospectoA: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function registrar(nombre: string) {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `${nombre} ${marca}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: `Persona ${nombre}`, correo: `ficha.${randomUUID()}@prospeccion.test` }
    });
    const [p] = await db.select({ empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, res.body.id));
    return { prospectoId: res.body.id as number, empresaId: p.empresaId };
  }

  async function crearTarea(titulo: string, empresaId: number, responsableId: number) {
    const res = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo, empresaId, responsableId });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
    agenteCookie = await crearAgente(app, adminCookie, `ficha.tareas.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;

    const a = await registrar("Moldes");
    empresaA = a.empresaId;
    prospectoA = a.prospectoId;
    empresaB = (await registrar("Transportes")).empresaId;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("GET /tareas?empresaId= trae solo las tareas de esa empresa", async () => {
    const t1 = await crearTarea(`Llamar ${marca} 1`, empresaA, adminId);
    const t2 = await crearTarea(`Llamar ${marca} 2`, empresaA, agenteId);
    const otra = await crearTarea(`Llamar ${marca} otra`, empresaB, adminId);

    const res = await api().get("/api/v1/tareas").set("Cookie", adminCookie).query({ empresaId: empresaA, limit: 100 });
    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: { id: number }) => t.id);
    expect(ids).toEqual(expect.arrayContaining([t1, t2]));
    expect(ids).not.toContain(otra);
    expect(res.body.data.every((t: { empresa_id: number }) => t.empresa_id === empresaA)).toBe(true);
  });

  it("un agente con empresaId sigue viendo solo sus propias tareas", async () => {
    const res = await api().get("/api/v1/tareas").set("Cookie", agenteCookie).query({ empresaId: empresaA, limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((t: { responsable_id: number }) => t.responsable_id === agenteId)).toBe(true);
  });

  it("empresaId inválido responde 400", async () => {
    const res = await api().get("/api/v1/tareas").set("Cookie", adminCookie).query({ empresaId: "abc" });
    expect(res.status).toBe(400);
  });

  it("GET /empresas/:id trae prospeccion (estado y correos), igual que la lista", async () => {
    await db.insert(envios).values({ prospectoId: prospectoA, canal: "correo", numeroContacto: 1, ventanaVenceEn: new Date(Date.now() + 86_400_000), ventanaEstado: "abierta", executionId: randomUUID(), enviadoEn: new Date() });

    const ficha = await api().get(`/api/v1/empresas/${empresaA}`).set("Cookie", adminCookie);
    expect(ficha.status).toBe(200);
    const lista = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ q: `Moldes ${marca}` });
    const enLista = lista.body.data.find((e: { id: number }) => e.id === empresaA);

    expect(ficha.body.prospeccion).toEqual({ estado: expect.any(String), envios: 1 });
    expect(ficha.body.prospeccion).toEqual(enLista.prospeccion);
  });

  it("una empresa que nunca fue prospecto trae prospeccion null", async () => {
    const creada = await api()
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: `Sin prospecto ${marca}`, contactos: [{ nombre: "Alguien", correo: `sinp.${randomUUID()}@test.local` }] });
    expect(creada.status).toBe(201);
    const ficha = await api().get(`/api/v1/empresas/${creada.body.id}`).set("Cookie", adminCookie);
    expect(ficha.status).toBe(200);
    expect(ficha.body.prospeccion).toBeNull();
  });
});
