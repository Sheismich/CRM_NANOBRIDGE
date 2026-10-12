import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, campanas, envios, prospectos, respuestas } from "../src/database/schema.js";
import { eq } from "drizzle-orm";

const API_KEY = "test_crm_callback_api_key_0001";

// Inicio nuevo (diseño aprobado el 9-oct-2026): la gráfica "correos enviados
// por día", los interesados por campaña y "Lo que acaba de pasar". Fechas de
// enero de 2021: no se cruzan con lo que siembran los demás archivos y en
// México no había horario de verano (el día se corta a las 06:00 UTC).
describe("inicio: prospección por día, interesados por campaña y actividad reciente", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let campana: number;
  let pBaja: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function registrarProspecto(campanaId: number, nombre: string) {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({
        execution_id: randomUUID(),
        empresa: { nombreLegal: `Empresa ${nombre} ${randomUUID()}` },
        contacto: { nombre, correo: `inicio.${randomUUID()}@prospeccion.test` },
        campana_id: campanaId
      });
    expect([200, 201]).toContain(res.status);
    return res.body.id as number;
  }

  async function sembrarEnvio(prospectoId: number, numeroContacto: number, instanteUtc: string) {
    const fecha = new Date(instanteUtc);
    const [r] = await db.insert(envios).values({
      prospectoId, canal: "correo", numeroContacto, ventanaVenceEn: new Date(fecha.getTime() + 7 * 86_400_000),
      ventanaEstado: "vencida", executionId: randomUUID(), enviadoEn: fecha
    });
    return r.insertId;
  }

  async function sembrarRespuesta(prospectoId: number, envioId: number, instanteUtc: string, extra: Partial<typeof respuestas.$inferInsert> = {}) {
    await db.insert(respuestas).values({ prospectoId, envioId, canal: "correo", contenido: "Sí nos interesa", executionId: randomUUID(), recibidoEn: new Date(instanteUtc), ...extra });
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `inicio.agente.${Date.now()}@test.local`);

    const [c] = await db.insert(campanas).values({ nombre: `Campaña inicio ${randomUUID()}`, estado: "activa" });
    campana = c.insertId;
    const p1 = await registrarProspecto(campana, "Ana Inicio");
    const p2 = await registrarProspecto(campana, "Beto Inicio");
    pBaja = await registrarProspecto(campana, "Carla Inicio");

    // 4 ene: dos iniciales (uno a las 23:30 de México = 05:30 UTC del 5, que
    // debe contar en el 4). 6 ene: un recordatorio. 5 ene: nada.
    const e1 = await sembrarEnvio(p1, 1, "2021-01-04T15:00:00Z");
    const e2 = await sembrarEnvio(p2, 1, "2021-01-05T05:30:00Z");
    await sembrarEnvio(p1, 2, "2021-01-06T16:00:00Z");
    await sembrarEnvio(pBaja, 1, "2021-01-06T17:00:00Z");
    // Respuestas: Ana interesada el 6; Beto, fuera de oficina el 6 (no cuenta).
    await sembrarRespuesta(p1, e1, "2021-01-06T18:00:00Z", { estado: "clasificada", clasificacion: "interesado", clasificadoEn: new Date("2021-01-06T18:05:00Z") });
    await sembrarRespuesta(p2, e2, "2021-01-06T19:00:00Z", { estado: "clasificada", clasificacion: "automatica", clasificadoEn: new Date("2021-01-06T19:00:00Z") });
    // Carla pidió su baja (así la registra darDeBajaProspecto).
    await db.update(prospectos).set({ estado: "baja" }).where(eq(prospectos.id, pBaja));
    await db.insert(auditoria).values({ usuarioId: null, entidad: "prospecto", entidadId: pBaja, accion: "cambiar_estado_automatizacion", antes: { estado: "validado" }, despues: { estado: "baja", motivo: "Baja por link de SendGrid" }, creadoEn: new Date("2021-01-06T20:00:00Z") });
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("por día: cuenta envíos y respuestas por día de México, con los días vacíos en cero", async () => {
    const res = await api().get("/api/v1/reportes/prospeccion/por-dia").set("Cookie", adminCookie)
      .query({ fechaInicio: "2021-01-04", fechaFin: "2021-01-07", campanaId: campana });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { fecha: "2021-01-04", envios: 2, respuestas: 0 },
      { fecha: "2021-01-05", envios: 0, respuestas: 0 },
      { fecha: "2021-01-06", envios: 2, respuestas: 1 },
      { fecha: "2021-01-07", envios: 0, respuestas: 0 }
    ]);
  });

  it("por día: exige las dos fechas y no más de 366 días", async () => {
    const sinFin = await api().get("/api/v1/reportes/prospeccion/por-dia").set("Cookie", adminCookie).query({ fechaInicio: "2021-01-04" });
    expect(sinFin.status).toBe(400);
    const largo = await api().get("/api/v1/reportes/prospeccion/por-dia").set("Cookie", adminCookie).query({ fechaInicio: "2019-01-01", fechaFin: "2021-01-01" });
    expect(largo.status).toBe(400);
  });

  it("prospección por campaña trae cuántas personas resultaron interesadas", async () => {
    const res = await api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie)
      .query({ fechaInicio: "2021-01-01", fechaFin: "2021-01-31", campanaId: campana });
    expect(res.status).toBe(200);
    expect(res.body.por_campana).toEqual([expect.objectContaining({ campana_id: campana, personas_contactadas: 3, personas_que_respondieron: 1, interesados: 1 })]);
  });

  it("actividad reciente: respuestas, envíos y bajas mezclados, lo más nuevo primero", async () => {
    const res = await api().get("/api/v1/reportes/actividad-reciente").set("Cookie", adminCookie)
      .query({ hasta: "2021-01-06", limit: 4 });
    expect(res.status).toBe(200);
    expect(res.body.map((e: { tipo: string }) => e.tipo)).toEqual(["baja", "respuesta", "respuesta", "envio"]);
    const [baja, automatica, interesada] = res.body;
    expect(baja).toEqual(expect.objectContaining({ prospecto_id: pBaja, contacto_nombre: "Carla Inicio", motivo: "Baja por link de SendGrid" }));
    expect(automatica.clasificacion).toBe("automatica");
    expect(interesada).toEqual(expect.objectContaining({ contacto_nombre: "Ana Inicio", clasificacion: "interesado", campana_id: campana }));
    expect(interesada.empresa_nombre).toMatch(/^Empresa Ana Inicio/);
    expect(res.body[3]).toEqual(expect.objectContaining({ tipo: "envio", numero_contacto: 1, contacto_nombre: "Carla Inicio" }));
  });

  it("actividad reciente es solo para administrador y supervisor", async () => {
    const res = await api().get("/api/v1/reportes/actividad-reciente").set("Cookie", agenteCookie);
    expect(res.status).toBe(403);
  });
});
