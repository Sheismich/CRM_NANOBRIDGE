import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { campanas, envios, prospectos, respuestas } from "../src/database/schema.js";
import { parseCsv } from "../src/shared/csv.js";

const API_KEY = "test_crm_callback_api_key_0001";

// "Interesados" cuenta personas distintas (16-oct-2026), como el resto de
// los reportes de prospección: quien contesta dos veces "me interesa" es
// una persona, y quien está interesado en dos campañas también. Antes
// Reportes · Día contaba respuestas y el informe ejecutivo sumaba las
// campañas. Día fijo del pasado para que las demás pruebas no se cuelen.
describe("reportes: interesados por persona", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const FECHA = "2025-04-08";
  const MES = FECHA.slice(0, 7);
  const a = (hhmm: string) => new Date(`${FECHA}T${hhmm}:00-06:00`);

  async function campana() {
    const [c] = await db.insert(campanas).values({ nombre: `Interesados ${randomUUID().slice(0, 8)}`, canal: "correo", estado: "activa" });
    return c.insertId;
  }

  // Un prospecto con su correo inicial y una respuesta clasificada.
  async function respuesta(prospectoId: number, clasificacion: "interesado" | "no_interesado", hhmm: string, numero = 1) {
    const [envio] = await db.insert(envios).values({ prospectoId, canal: "correo", numeroContacto: numero, ventanaVenceEn: a("23:00"), ventanaEstado: "cerrada", executionId: randomUUID(), enviadoEn: a("08:00") });
    await db.insert(respuestas).values({ prospectoId, envioId: envio.insertId, canal: "correo", contenido: "Me interesa", estado: "clasificada", clasificacion, recibidoEn: a(hhmm), clasificadoEn: a(hhmm) });
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("una persona que contesta dos veces o está en dos campañas cuenta como un interesado", async () => {
    const dia = () => api().get("/api/v1/reportes/dia").set("Cookie", adminCookie).query({ fecha: FECHA });
    const prospeccion = () => api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie).query({ fechaInicio: FECHA, fechaFin: FECHA });
    const antesDia = (await dia()).body.resumen.respuestas.interesados as number;
    const antesTotal = (await prospeccion()).body.respuestas.personas_interesadas as number;

    const campanaA = await campana();
    const campanaB = await campana();
    const reg = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Interesada ${randomUUID().slice(0, 8)}` },
      contacto: { nombre: "Persona Interesada", correo: `interesada.${randomUUID()}@prospeccion.test` },
      campana_id: campanaA
    });
    expect(reg.status).toBeLessThan(300);
    const enA = reg.body.id as number;
    // La misma persona, en otra campaña.
    const [otro] = await db.insert(prospectos).values({ contactoId: reg.body.contacto_id, campanaId: campanaB, estado: "interesado" });
    const enB = otro.insertId;

    await respuesta(enA, "interesado", "09:00", 1);
    await respuesta(enA, "interesado", "10:00", 2);
    await respuesta(enB, "interesado", "11:00", 1);

    expect((await dia()).body.resumen.respuestas.interesados).toBe(antesDia + 1);

    const res = await prospeccion();
    expect(res.body.respuestas.personas_interesadas).toBe(antesTotal + 1);
    const porCampana = Object.fromEntries(res.body.por_campana.map((c: { campana_id: number; interesados: number }) => [c.campana_id, c.interesados]));
    expect(porCampana[campanaA]).toBe(1);
    expect(porCampana[campanaB]).toBe(1);

    // El informe ejecutivo ya no suma las campañas.
    const informe = await api().get("/api/v1/reportes/export/informe-ejecutivo").set("Cookie", adminCookie).query({ formato: "csv", mes: MES });
    expect(informe.status).toBe(200);
    const fila = parseCsv(informe.text).filas.find((f) => f.seccion === "prospeccion" && f.indicador === "interesados");
    const mesCompleto = await api().get("/api/v1/reportes/prospeccion").set("Cookie", adminCookie).query({ fechaInicio: `${MES}-01`, fechaFin: `${MES}-30` });
    expect(Number(fila?.valor)).toBe(mesCompleto.body.respuestas.personas_interesadas);
  });
});
