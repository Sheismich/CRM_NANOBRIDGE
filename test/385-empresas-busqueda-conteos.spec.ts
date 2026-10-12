import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, empresas, envios, prospectos, respuestas } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Empresas nuevas (lista + tarjetas, 9-oct-2026): buscar, filtrar,
// ordenar por última actividad, en qué va la prospección de cada una, qué
// fue lo último que pasó y los conteos de las tarjetas de arriba.
describe("empresas: búsqueda, filtros, prospección por empresa y conteos", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let empInteresada: number;
  let empSinNada: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function registrar(nombre: string, giro: string, ciudad: string) {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `${nombre} ${marca}`, giro, ciudad, region: `Region ${marca}` },
      contacto: { nombre: `Persona ${nombre}`, correo: `emp.${randomUUID()}@prospeccion.test` }
    });
    const [p] = await db.select({ empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, res.body.id));
    return { prospectoId: res.body.id as number, empresaId: p.empresaId };
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `emp.busq.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;

    const a = await registrar("Moldes", "Manufactura", "Silao");
    empInteresada = a.empresaId;
    const [e] = await db.insert(envios).values({ prospectoId: a.prospectoId, canal: "correo", numeroContacto: 2, ventanaVenceEn: new Date(Date.now() + 86_400_000), ventanaEstado: "cerrada", executionId: randomUUID(), enviadoEn: new Date(Date.now() - 2 * 86_400_000) });
    await db.insert(respuestas).values({ prospectoId: a.prospectoId, envioId: e.insertId, canal: "correo", contenido: "Sí", executionId: randomUUID(), estado: "clasificada", clasificacion: "interesado", recibidoEn: new Date(Date.now() - 86_400_000) });
    await db.update(prospectos).set({ estado: "interesado" }).where(eq(prospectos.id, a.prospectoId));

    const b = await registrar("Transportes", "Logística", "Chihuahua");
    empSinNada = b.empresaId;
    await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, empSinNada));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("busca por nombre, giro o ciudad", async () => {
    const porGiro = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ q: "Logística", region: `Region ${marca}` });
    expect(porGiro.body.data.map((f: { id: number }) => f.id)).toEqual([empSinNada]);
    const porCiudad = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ q: "Silao", region: `Region ${marca}` });
    expect(porCiudad.body.data.map((f: { id: number }) => f.id)).toEqual([empInteresada]);
  });

  it("filtra por responsable o sin responsable", async () => {
    const delAgente = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ responsableId: agenteId, region: `Region ${marca}` });
    expect(delAgente.body.data.map((f: { id: number }) => f.id)).toEqual([empSinNada]);
    const sinDueno = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ sinResponsable: "true", region: `Region ${marca}` });
    expect(sinDueno.body.data.map((f: { id: number }) => f.id)).toEqual([empInteresada]);
  });

  it("ordena por última actividad, la más reciente primero y las que no tienen nada al final", async () => {
    const res = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ region: `Region ${marca}`, orden: "actividad" });
    expect(res.body.data.map((f: { id: number }) => f.id)).toEqual([empInteresada, empSinNada]);
  });

  it("cada empresa dice en qué va su prospección y qué fue lo último que pasó", async () => {
    const res = await api().get("/api/v1/empresas").set("Cookie", adminCookie).query({ region: `Region ${marca}` });
    const moldes = res.body.data.find((f: { id: number }) => f.id === empInteresada);
    expect(moldes.prospeccion).toEqual({ estado: "interesado", envios: 1 });
    expect(moldes.ultima_actividad_detalle).toEqual({ tipo: "respuesta", clasificacion: "interesado" });
    const transportes = res.body.data.find((f: { id: number }) => f.id === empSinNada);
    expect(transportes.prospeccion).toEqual({ estado: "capturado", envios: 0 });
    expect(transportes.ultima_actividad_detalle).toBeNull();
  });

  it("la ficha dice de dónde vino la empresa (la fuente de su prospecto)", async () => {
    const [p] = await db.select({ id: prospectos.id }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(contactos.empresaId, empInteresada));
    await db.update(prospectos).set({ fuenteUrl: "https://linkedin.com/company/moldes" }).where(eq(prospectos.id, p.id));
    const res = await api().get(`/api/v1/empresas/${empInteresada}`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.fuente_url).toBe("https://linkedin.com/company/moldes");
  });

  it("conteos: total, sin responsable, sin actividad reciente y con oportunidad abierta", async () => {
    const res = await api().get("/api/v1/empresas/conteos").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ total: expect.any(Number), sin_responsable: expect.any(Number), sin_actividad_30_dias: expect.any(Number), con_oportunidad_abierta: expect.any(Number) }));
    expect(res.body.valor_oportunidades_abiertas).toEqual(expect.any(String));
    const agente = await api().get("/api/v1/empresas/conteos").set("Cookie", agenteCookie);
    expect(agente.body.total).toBe(1);
    expect(agente.body.sin_responsable).toBe(0);
    expect(agente.body.sin_actividad_30_dias).toBe(1);
  });
});
