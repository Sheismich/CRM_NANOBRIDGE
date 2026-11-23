import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq, gt, inArray, max } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { envios, notificaciones, parametrosAutomatizacion } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Aviso de "n8n no corrió" (#2 de la revisión del 20-nov-2026). Lo dispara un
// Cloud Scheduler de Google a las 11:00, no n8n: si n8n se cae, PT5 también.
// Las pruebas fijan el reloj en marzo de 2020: así ningún envío ni latido de
// otras pruebas (todos de 2026) cae en "hoy" o en "hace más de una hora".
const MARTES = "2020-03-03T17:00:00Z"; // 11:00 en México
const SABADO = "2020-03-07T17:00:00Z";
const FERIADO = "2020-03-16T17:00:00Z"; // tercer lunes de marzo

describe("aviso de n8n sin correr", () => {
  let app: INestApplication;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  let ultimaNotificacion = 0;

  beforeAll(async () => {
    app = await createTestApp();
    await ensureSeedAdmin(app);
  });

  beforeEach(async () => {
    await db.delete(parametrosAutomatizacion).where(inArray(parametrosAutomatizacion.clave, ["latido_n8n_pt4", "latido_n8n_pt1a", "aviso_n8n"]));
    const [fila] = await db.select({ id: max(notificaciones.id) }).from(notificaciones);
    ultimaNotificacion = fila?.id ?? 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const enFecha = (instante: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(instante) });
  const revisar = (apiKey: string | null = API_KEY) => {
    const req = api().post("/api/v1/automatizacion/jobs/revisar-n8n");
    return apiKey ? req.set("X-API-Key", apiKey) : req;
  };
  const llamaPt4 = () => api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY).query({ limit: 1 });
  const llamaPt1a = () => api().post("/api/v1/automatizacion/prospectos/fila/tomar").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), limite: 1 });
  const avisosNuevos = () => db
    .select({ titulo: notificaciones.titulo, cuerpo: notificaciones.cuerpo, enlace: notificaciones.enlace, correoEstado: notificaciones.correoEstado })
    .from(notificaciones)
    .where(and(gt(notificaciones.id, ultimaNotificacion), eq(notificaciones.tipo, "n8n_sin_correr")));

  async function envioAtorado(enviadoEn: string) {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Empresa Atorada ${randomUUID()}`, giro: "manufactura" },
      contacto: { nombre: "Persona Atorada", correo: `atorado.${randomUUID()}@aviso-n8n.test` }
    });
    expect([200, 201]).toContain(res.status);
    const [result] = await db.insert(envios).values({
      prospectoId: res.body.id,
      canal: "correo",
      numeroContacto: 1,
      enviadoEn: new Date(enviadoEn),
      ventanaVenceEn: new Date(Date.parse(enviadoEn) + 7 * 86_400_000),
      estado: "registrado",
      destinatario: "atorado@aviso-n8n.test",
      executionId: randomUUID()
    });
    return result.insertId;
  }

  it("sin X-API-Key es 401", async () => {
    expect((await revisar(null)).status).toBe(401);
  });

  it("PT4 y PT1a dejan anotada la hora en que llamaron", async () => {
    enFecha(MARTES);
    expect((await llamaPt4()).status).toBe(200);
    expect((await llamaPt1a()).status).toBe(200);
    const filas = await db.select({ clave: parametrosAutomatizacion.clave, valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion)
      .where(inArray(parametrosAutomatizacion.clave, ["latido_n8n_pt4", "latido_n8n_pt1a"]));
    expect(Object.fromEntries(filas.map((f) => [f.clave, f.valor]))).toEqual({
      latido_n8n_pt4: { en: new Date(MARTES).toISOString() },
      latido_n8n_pt1a: { en: new Date(MARTES).toISOString() }
    });
  });

  it("día hábil sin llamadas: avisa a los administradores, con correo", async () => {
    enFecha(MARTES);
    const res = await revisar();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ job: "revisar-n8n", fecha: "2020-03-03", dia_habil: true, faltan: ["pt4", "pt1a"], envios_sin_confirmar: 0, avisado: true });
    const avisos = await avisosNuevos();
    expect(avisos.length).toBeGreaterThan(0);
    expect(avisos[0]).toMatchObject({ titulo: "La automatización no corrió hoy", enlace: "/administracion" });
    // Con correo: lo manda la API al terminar la petición, no n8n.
    expect(avisos.some((a) => a.correoEstado === "enviado")).toBe(true);
    expect(avisos[0]!.cuerpo).toContain("PT4");
    expect(avisos[0]!.cuerpo).toContain("PT1a");
  });

  it("solo falta uno: el aviso dice cuál", async () => {
    enFecha(MARTES);
    await llamaPt4();
    const res = await revisar();
    expect(res.body).toMatchObject({ faltan: ["pt1a"], avisado: true });
    const [aviso] = await avisosNuevos();
    expect(aviso!.cuerpo).toContain("PT1a");
    expect(aviso!.cuerpo).not.toContain("PT4");
  });

  it("con las dos llamadas de hoy no avisa", async () => {
    enFecha(MARTES);
    await llamaPt4();
    await llamaPt1a();
    expect((await revisar()).body).toMatchObject({ faltan: [], envios_sin_confirmar: 0, avisado: false });
    expect(await avisosNuevos()).toEqual([]);
  });

  it("una llamada de otro día no cuenta", async () => {
    enFecha("2020-03-02T17:00:00Z");
    await llamaPt4();
    await llamaPt1a();
    enFecha(MARTES);
    expect((await revisar()).body).toMatchObject({ faltan: ["pt4", "pt1a"], avisado: true });
  });

  it("correrlo dos veces el mismo día avisa una sola vez", async () => {
    enFecha(MARTES);
    expect((await revisar()).body.avisado).toBe(true);
    const primeros = (await avisosNuevos()).length;
    expect((await revisar()).body).toMatchObject({ faltan: ["pt4", "pt1a"], avisado: false });
    expect((await avisosNuevos()).length).toBe(primeros);
  });

  it.each([["sábado", SABADO, "2020-03-07"], ["feriado", FERIADO, "2020-03-16"]])("en %s no avisa", async (_nombre, instante, fecha) => {
    enFecha(instante);
    expect((await revisar()).body).toEqual({ job: "revisar-n8n", fecha, dia_habil: false, faltan: [], envios_sin_confirmar: 0, avisado: false });
    expect(await avisosNuevos()).toEqual([]);
  });

  it("un envío registrado hace más de una hora sin confirmar: avisa aunque n8n sí haya llamado", async () => {
    const envioId = await envioAtorado("2020-03-03T15:30:00Z");
    try {
      enFecha(MARTES);
      await llamaPt4();
      await llamaPt1a();
      expect((await revisar()).body).toMatchObject({ faltan: [], envios_sin_confirmar: 1, avisado: true });
      const [aviso] = await avisosNuevos();
      expect(aviso).toMatchObject({ titulo: "Hay correos atorados en la automatización" });
      expect(aviso!.cuerpo).toContain("1 correo");
    } finally {
      await db.delete(envios).where(eq(envios.id, envioId));
    }
  });

  it("uno registrado hace menos de una hora todavía no cuenta", async () => {
    const envioId = await envioAtorado("2020-03-03T16:30:00Z");
    try {
      enFecha(MARTES);
      await llamaPt4();
      await llamaPt1a();
      expect((await revisar()).body).toMatchObject({ envios_sin_confirmar: 0, avisado: false });
    } finally {
      await db.delete(envios).where(eq(envios.id, envioId));
    }
  });
});
