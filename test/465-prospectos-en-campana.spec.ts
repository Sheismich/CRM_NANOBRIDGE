import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { campanas, envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Embudo de Prospectos (revisión de la vista previa, 15-oct-2026): "En
// campaña" contaba a todos los que alguna vez recibieron correo (también a
// los que respondieron o se dieron de baja) y se cruzaba con las demás
// tarjetas. Ahora: en campaña = validado que ya recibió correo; validado sin
// correos = "listo para campaña". Las dos tarjetas filtran la lista.
describe("prospectos: en campaña exacto (conteo y filtro)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let campanaId: number;
  let listo: number;
  let enCampana: number;
  let respondio: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function registrar(estado: "validado" | "interesado", correos: number) {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Campaña exacta ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo: `encamp.${randomUUID()}@prospeccion.test` }
    });
    const id = res.body.id as number;
    await db.update(prospectos).set({ estado, campanaId }).where(eq(prospectos.id, id));
    for (let n = 1; n <= correos; n++) {
      await db.insert(envios).values({ prospectoId: id, canal: "correo", numeroContacto: n, ventanaVenceEn: new Date(Date.now() + 86_400_000), ventanaEstado: "cerrada", executionId: randomUUID(), enviadoEn: new Date() });
    }
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const [c] = await db.insert(campanas).values({ nombre: `Exacta ${randomUUID().slice(0, 8)}`, canal: "correo", estado: "activa" });
    campanaId = c.insertId;
    listo = await registrar("validado", 0);
    enCampana = await registrar("validado", 2);
    respondio = await registrar("interesado", 1);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("conteos trae en_campana = validados con al menos un correo", async () => {
    const res = await api().get("/api/v1/prospectos/conteos").set("Cookie", adminCookie).query({ campanaId });
    expect(res.status).toBe(200);
    expect(res.body.en_campana).toBe(1);
    // contactados sigue igual (todos los que recibieron correo).
    expect(res.body.contactados).toBe(2);
    expect(res.body.por_estado.find((e: { estado: string }) => e.estado === "validado").cantidad).toBe(2);
  });

  it("enCampana=true filtra a los validados con correos", async () => {
    const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ campanaId, enCampana: "true", limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { id: number }) => p.id)).toEqual([enCampana]);
  });

  it("enCampana=false con estado=validado da los listos para campaña", async () => {
    const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ campanaId, estado: "validado", enCampana: "false", limit: 100 });
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { id: number }) => p.id)).toEqual([listo]);
  });

  it("sin enCampana la lista no cambia", async () => {
    const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ campanaId, limit: 100 });
    expect(res.body.data.map((p: { id: number }) => p.id).sort()).toEqual([listo, enCampana, respondio].sort());
  });

  it("enCampana con un valor raro responde 400", async () => {
    const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ enCampana: "quizas" });
    expect(res.status).toBe(400);
  });
});
