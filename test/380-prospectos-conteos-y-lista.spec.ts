import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { campanas, contactos, empresas, envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Prospectos nuevos (embudo + lista, 9-oct-2026): conteos por estado para
// las tarjetas del embudo y, en cada fila, la campaña, la empresa y cuántos
// correos lleva ("1/3").
describe("prospectos: conteos por estado y lista con más contexto", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let campana: number;
  let pConEnvios: number;
  let pAgente: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function registrar(nombre: string, extra: Record<string, unknown> = {}) {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Emp ${nombre} ${marca}`, giro: "Manufactura", estado: "Guanajuato" },
      contacto: { nombre: `${nombre} ${marca}`, puesto: "Compras", correo: `pc.${randomUUID()}@prospeccion.test` },
      campana_id: campana,
      ...extra
    });
    expect([200, 201]).toContain(res.status);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `pros.conteos.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
    const [c] = await db.insert(campanas).values({ nombre: `Campaña conteos ${marca}`, estado: "activa" });
    campana = c.insertId;

    pConEnvios = await registrar("Ana");
    await registrar("Beto");
    pAgente = await registrar("Ceci");
    for (const n of [1, 2]) {
      await db.insert(envios).values({ prospectoId: pConEnvios, canal: "correo", numeroContacto: n, ventanaVenceEn: new Date(Date.now() + 86_400_000), ventanaEstado: n === 2 ? "abierta" : "vencida", executionId: randomUUID(), enviadoEn: new Date(Date.now() - (3 - n) * 86_400_000) });
    }
    // Ceci es de una empresa del agente.
    const [p] = await db.select({ empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, pAgente));
    await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, p.empresaId));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("la lista trae empresa, contacto, campaña y cuántos correos lleva cada prospecto", async () => {
    const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ q: marca });
    expect(res.status).toBe(200);
    const ana = res.body.data.find((f: { id: number }) => f.id === pConEnvios);
    expect(ana).toEqual(expect.objectContaining({
      empresa_giro: "Manufactura", empresa_estado: "Guanajuato", contacto_puesto: "Compras",
      campana_id: campana, campana_nombre: `Campaña conteos ${marca}`, envios: 2
    }));
    expect(ana.ultimo_envio_en).toBeTruthy();
    const beto = res.body.data.find((f: { contacto_nombre: string }) => f.contacto_nombre === `Beto ${marca}`);
    expect(beto.envios).toBe(0);
  });

  it("ordena por score de mayor a menor si se pide", async () => {
    await db.update(prospectos).set({ score: "90.00" }).where(eq(prospectos.id, pAgente));
    await db.update(prospectos).set({ score: "40.00" }).where(eq(prospectos.id, pConEnvios));
    const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ q: marca, orden: "score" });
    expect(res.body.data[0].id).toBe(pAgente);
  });

  it("conteos: cuántos hay en cada estado y cuántos ya recibieron algún correo", async () => {
    const res = await api().get("/api/v1/prospectos/conteos").set("Cookie", adminCookie).query({ campanaId: campana });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.contactados).toBe(1);
    expect(res.body.por_estado.reduce((s: number, e: { cantidad: number }) => s + e.cantidad, 0)).toBe(3);
  });

  it("un agente solo cuenta los de sus empresas", async () => {
    const res = await api().get("/api/v1/prospectos/conteos").set("Cookie", agenteCookie).query({ campanaId: campana });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });
});
