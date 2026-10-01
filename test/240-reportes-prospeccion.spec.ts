import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { campanas, envios, respuestas } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// GET /reportes/prospeccion: cuánto se escribió y cuánto se respondió. Los
// reportes de antes solo cubrían el pipeline comercial. La tasa de respuesta
// no cuenta las respuestas automáticas (fuera de oficina): no son de la
// persona (PLAN_N8N_DEFINITIVO.md, ronda 3). Las fechas son de 2021 para no
// cruzarse con lo que siembran los demás archivos (todos usan "ahora").
describe("reportes: prospección", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let campanaA: number;
  let campanaB: number;
  const db = testDb();
  const RANGO = { fechaInicio: "2021-03-01", fechaFin: "2021-03-31" };

  const api = () => request(app.getHttpServer());

  async function crearCampana() {
    const [result] = await db.insert(campanas).values({ nombre: `Campaña reporte ${randomUUID()}`, estado: "activa" });
    return result.insertId;
  }

  async function registrarProspecto(campanaId: number) {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({
        execution_id: randomUUID(),
        empresa: { nombreLegal: `Empresa Reporte ${randomUUID()}` },
        contacto: { nombre: "Persona Reporte", correo: `reporte.${randomUUID()}@prospeccion.test` },
        campana_id: campanaId
      });
    expect([200, 201]).toContain(res.status);
    return res.body.id as number;
  }

  async function sembrarEnvio(prospectoId: number, numeroContacto: number, enviadoEn: string) {
    const fecha = new Date(`${enviadoEn}T12:00:00`);
    const [result] = await db.insert(envios).values({
      prospectoId,
      canal: "correo",
      numeroContacto,
      ventanaVenceEn: new Date(fecha.getTime() + 7 * 86_400_000),
      ventanaEstado: "vencida",
      executionId: randomUUID(),
      enviadoEn: fecha
    });
    return result.insertId;
  }

  async function sembrarRespuesta(prospectoId: number, envioId: number, recibidoEn: string, extra: Partial<typeof respuestas.$inferInsert> = {}) {
    await db.insert(respuestas).values({
      prospectoId,
      envioId,
      canal: "correo",
      contenido: "respuesta de prueba",
      executionId: randomUUID(),
      recibidoEn: new Date(`${recibidoEn}T12:00:00`),
      ...extra
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `prospeccion.agente.${Date.now()}@test.local`);

    // Campaña A: tres personas. La 1 recibe el inicial y un recordatorio y
    // responde "interesado"; la 2 solo manda un fuera de oficina; la 3
    // responde tarde y su respuesta sigue sin clasificar.
    campanaA = await crearCampana();
    const p1 = await registrarProspecto(campanaA);
    const p2 = await registrarProspecto(campanaA);
    const p3 = await registrarProspecto(campanaA);
    await sembrarEnvio(p1, 1, "2021-03-02");
    const p1e2 = await sembrarEnvio(p1, 2, "2021-03-10");
    const p2e1 = await sembrarEnvio(p2, 1, "2021-03-03");
    const p3e1 = await sembrarEnvio(p3, 1, "2021-03-04");
    await sembrarRespuesta(p1, p1e2, "2021-03-11", { estado: "clasificada", clasificacion: "interesado", clasificadoEn: new Date("2021-03-12T12:00:00") });
    await sembrarRespuesta(p2, p2e1, "2021-03-05", { estado: "clasificada", clasificacion: "automatica", clasificadoEn: new Date("2021-03-05T12:00:00") });
    await sembrarRespuesta(p3, p3e1, "2021-03-20", { tardia: true });

    // Fuera del rango: no cuenta.
    const fuera = await registrarProspecto(campanaA);
    await sembrarEnvio(fuera, 1, "2021-04-05");

    // Campaña B: una persona contactada, sin respuesta.
    campanaB = await crearCampana();
    const pb = await registrarProspecto(campanaB);
    await sembrarEnvio(pb, 1, "2021-03-15");
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("cuenta envíos, personas y respuestas de una campaña, sin contar las automáticas en la tasa", async () => {
    const res = await api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie).query({ ...RANGO, campanaId: campanaA });
    expect(res.status).toBe(200);
    expect(res.body.envios).toEqual({ total: 4, inicial: 3, recordatorio_1: 1, recordatorio_2: 0, personas_contactadas: 3 });
    expect(res.body.respuestas).toEqual({
      total: 2,
      automaticas: 1,
      tardias: 1,
      pendientes_clasificar: 1,
      por_clasificacion: [{ clasificacion: "interesado", cantidad: 1 }],
      personas_que_respondieron: 2
    });
    expect(res.body.tasa_respuesta_pct).toBe(66.67);
    expect(res.body.por_campana).toEqual([
      expect.objectContaining({ campana_id: campanaA, envios: 4, personas_contactadas: 3, personas_que_respondieron: 2, tasa_respuesta_pct: 66.67 })
    ]);
  });

  it("sin campaña desglosa por campaña; una sin respuestas queda en 0%", async () => {
    const res = await api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie).query(RANGO);
    expect(res.status).toBe(200);
    const filaB = res.body.por_campana.find((c: { campana_id: number }) => c.campana_id === campanaB);
    expect(filaB).toEqual(expect.objectContaining({ envios: 1, personas_contactadas: 1, personas_que_respondieron: 0, tasa_respuesta_pct: 0 }));
    expect(res.body.envios.total).toBeGreaterThanOrEqual(5);
  });

  it("sin envíos en el rango la tasa es null, no una división entre cero", async () => {
    const res = await api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie).query({ fechaInicio: "2001-01-01", fechaFin: "2001-01-31" });
    expect(res.status).toBe(200);
    expect(res.body.envios.total).toBe(0);
    expect(res.body.tasa_respuesta_pct).toBeNull();
    expect(res.body.por_campana).toEqual([]);
  });

  it("se exporta como CSV, una fila por campaña", async () => {
    const res = await api().get("/api/v1/reportes/export/prospeccion").set("Cookie", adminCookie).query({ ...RANGO, campanaId: campanaA });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lineas = res.text.trim().split(/\r?\n/);
    expect(lineas[0]).toContain("campana_id");
    expect(lineas).toHaveLength(2);
  });

  it("solo administrador/supervisor (un agente recibe 403) y valida el rango", async () => {
    expect((await api().get("/api/v1/reportes/prospeccion").set("Cookie", agenteCookie)).status).toBe(403);
    expect((await api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie).query({ fechaInicio: "2021-03-31", fechaFin: "2021-03-01" })).status).toBe(400);
  });
});
