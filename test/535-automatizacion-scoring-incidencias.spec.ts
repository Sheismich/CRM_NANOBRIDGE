import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { incidencias, prospectos, resultadosScoring } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Las 3 rutas de /automatizacion que usa n8n y no tenían prueba propia
// (PLAN_FRONTEND.md, "Fuera de alcance", revisado el 16-oct-2026):
// GET /prospectos/scoring (lo que PT1 le da a Gemini para calificar),
// POST /scoring (el resultado) y POST /incidencias.
describe("automatización: scoring e incidencias", () => {
  let app: INestApplication;
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function prospecto() {
    const correo = `scoring.${randomUUID()}@cliente.test`;
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({
        execution_id: randomUUID(),
        empresa: { nombreLegal: `Moldes Scoring ${randomUUID().slice(0, 6)}`, giro: "manufactura", tamano: "mediana", ciudad: "Silao" },
        contacto: { nombre: "Laura Gómez", puesto: "Gerente de compras", correo, telefono: "4421234567" }
      });
    expect(res.status).toBe(201);
    return { id: res.body.id as number, correo };
  }

  const calificar = (body: Record<string, unknown>) => api().post("/api/v1/automatizacion/scoring").set("X-API-Key", API_KEY).send(body);
  const reportar = (body: Record<string, unknown>) => api().post("/api/v1/automatizacion/incidencias").set("X-API-Key", API_KEY).send(body);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("las tres piden la llave de n8n", async () => {
    expect((await api().get("/api/v1/automatizacion/prospectos/scoring").query({ prospecto_id: 1 })).status).toBe(401);
    expect((await api().post("/api/v1/automatizacion/scoring").send({})).status).toBe(401);
    expect((await api().post("/api/v1/automatizacion/incidencias").send({})).status).toBe(401);
  });

  describe("GET /prospectos/scoring", () => {
    it("regresa empresa y contacto para calificar, sin correo ni teléfono", async () => {
      const { id, correo } = await prospecto();
      const res = await api().get("/api/v1/automatizacion/prospectos/scoring").set("X-API-Key", API_KEY).query({ prospecto_id: id });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(
        expect.objectContaining({
          prospecto_id: id,
          contacto: { nombre: "Laura Gómez", puesto: "Gerente de compras", area: null },
          empresa: expect.objectContaining({ giro: "manufactura", tamano: "mediana", ciudad: "Silao" })
        })
      );
      const texto = JSON.stringify(res.body);
      expect(texto).not.toContain(correo);
      expect(texto).not.toContain("4421234567");
    });

    it("prospecto que no existe: 404; sin prospecto_id: 400", async () => {
      expect((await api().get("/api/v1/automatizacion/prospectos/scoring").set("X-API-Key", API_KEY).query({ prospecto_id: 999999999 })).status).toBe(404);
      expect((await api().get("/api/v1/automatizacion/prospectos/scoring").set("X-API-Key", API_KEY)).status).toBe(400);
    });
  });

  describe("POST /scoring", () => {
    it("guarda el resultado y le pone al prospecto el score, la prioridad y la confianza", async () => {
      const { id } = await prospecto();
      const executionId = randomUUID();
      const res = await calificar({ execution_id: executionId, prospecto_id: id, score: 82.5, prioridad: "alta", confianza: "media", metodo: "gemini", detalle: { razon: "Giro y tamaño ideales" } });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ id: expect.any(Number), ya_existia: false });

      const [fila] = await db.select().from(resultadosScoring).where(eq(resultadosScoring.id, res.body.id));
      expect(fila).toEqual(expect.objectContaining({ executionId, prospectoId: id, score: "82.50", prioridad: "alta", confianza: "media", metodo: "gemini", detalle: { razon: "Giro y tamaño ideales" } }));
      const [p] = await db.select({ score: prospectos.score, prioridad: prospectos.prioridad, confianza: prospectos.confianza }).from(prospectos).where(eq(prospectos.id, id));
      expect(p).toEqual({ score: "82.50", prioridad: "alta", confianza: "media" });
    });

    it("sin prioridad ni confianza solo cambia el score (no borra las que ya tenía)", async () => {
      const { id } = await prospecto();
      expect((await calificar({ execution_id: randomUUID(), prospecto_id: id, score: 70, prioridad: "media", confianza: "alta", metodo: "gemini" })).status).toBe(201);
      expect((await calificar({ execution_id: randomUUID(), prospecto_id: id, score: 40, metodo: "reglas" })).status).toBe(201);
      const [p] = await db.select({ score: prospectos.score, prioridad: prospectos.prioridad, confianza: prospectos.confianza }).from(prospectos).where(eq(prospectos.id, id));
      expect(p).toEqual({ score: "40.00", prioridad: "media", confianza: "alta" });
    });

    it("el mismo execution_id dos veces (reintento de n8n): 200 con el mismo id y sin tocar el prospecto", async () => {
      const { id } = await prospecto();
      const executionId = randomUUID();
      const primera = await calificar({ execution_id: executionId, prospecto_id: id, score: 60, metodo: "gemini" });
      const segunda = await calificar({ execution_id: executionId, prospecto_id: id, score: 95, metodo: "gemini" });
      expect(primera.status).toBe(201);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toEqual({ id: primera.body.id, ya_existia: true });
      expect(await db.select().from(resultadosScoring).where(eq(resultadosScoring.executionId, executionId))).toHaveLength(1);
      const [p] = await db.select({ score: prospectos.score }).from(prospectos).where(eq(prospectos.id, id));
      expect(p.score).toBe("60.00");
    });

    it("valida lo que llega: score de 0 a 100, método y prioridad conocidos; prospecto que no existe, 404", async () => {
      const { id } = await prospecto();
      const base = { execution_id: randomUUID(), prospecto_id: id, score: 50, metodo: "gemini" };
      expect((await calificar({ ...base, score: 101 })).status).toBe(400);
      expect((await calificar({ ...base, score: -1 })).status).toBe(400);
      expect((await calificar({ ...base, metodo: "adivinanza" })).status).toBe(400);
      expect((await calificar({ ...base, prioridad: "urgente" })).status).toBe(400);
      expect((await calificar({ ...base, execution_id: undefined })).status).toBe(400);
      expect((await calificar({ ...base, prospecto_id: 999999999 })).status).toBe(404);
    });
  });

  describe("POST /incidencias", () => {
    it("guarda la incidencia abierta, con severidad media si no viene", async () => {
      const { id } = await prospecto();
      const res = await reportar({ execution_id: randomUUID(), prospecto_id: id, tipo: "scoring_sin_respuesta", mensaje: "Gemini no contestó", detalle: { intento: 3 } });
      expect(res.status).toBe(201);
      const [fila] = await db.select().from(incidencias).where(eq(incidencias.id, res.body.id));
      expect(fila).toEqual(expect.objectContaining({ prospectoId: id, tipo: "scoring_sin_respuesta", severidad: "media", mensaje: "Gemini no contestó", detalle: { intento: 3 }, estado: "abierta" }));
    });

    it("sin prospecto ni execution_id también se guarda (un error general del flujo)", async () => {
      const res = await reportar({ tipo: "sendgrid_caido", severidad: "alta", mensaje: "SendGrid regresó 503" });
      expect(res.status).toBe(201);
      const [fila] = await db.select().from(incidencias).where(eq(incidencias.id, res.body.id));
      expect(fila).toEqual(expect.objectContaining({ prospectoId: null, executionId: null, severidad: "alta" }));
    });

    it("mismo execution_id y tipo dos veces: 200 con el mismo id; con otro tipo es otra incidencia", async () => {
      const executionId = randomUUID();
      const primera = await reportar({ execution_id: executionId, tipo: "validacion", mensaje: "Correo inválido" });
      const repetida = await reportar({ execution_id: executionId, tipo: "validacion", mensaje: "Correo inválido" });
      const otra = await reportar({ execution_id: executionId, tipo: "scoring", mensaje: "Sin giro" });
      expect(primera.status).toBe(201);
      expect(repetida.status).toBe(200);
      expect(repetida.body).toEqual({ id: primera.body.id, ya_existia: true });
      expect(otra.status).toBe(201);
      expect(otra.body.id).not.toBe(primera.body.id);
    });

    it("valida lo que llega; prospecto que no existe, 404", async () => {
      expect((await reportar({ tipo: "x", mensaje: "Muy corto el tipo" })).status).toBe(400);
      expect((await reportar({ tipo: "validacion", mensaje: "" })).status).toBe(400);
      expect((await reportar({ tipo: "validacion", mensaje: "Algo", severidad: "critica" })).status).toBe(400);
      expect((await reportar({ prospecto_id: 999999999, tipo: "validacion", mensaje: "Algo" })).status).toBe(404);
    });
  });
});
