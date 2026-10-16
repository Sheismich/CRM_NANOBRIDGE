import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb } from "./support/db.js";

const API_KEY = "test_crm_callback_api_key_0001";

// El aviso de PT2 al supervisor decía solo "Prospecto: 29" (16-oct-2026):
// /respuestas y /respuestas/clasificacion regresan también el nombre del
// contacto y de la empresa, para que n8n los ponga sin otra consulta.
describe("automatización: respuestas con nombre de contacto y empresa", () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("registrar y clasificar la respuesta dicen quién es; una sin identificar va en null", async () => {
    const empresa = `Aceros Aviso ${randomUUID().slice(0, 6)}`;
    const prospecto = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: empresa }, contacto: { nombre: "Laura Méndez", correo: `aviso.${randomUUID()}@respuestas.test` } });
    expect(prospecto.status).toBe(201);

    const recibida = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: prospecto.body.id, canal: "correo", contenido: "Me interesa, llámenme" });
    expect(recibida.status).toBe(201);
    expect(recibida.body).toEqual(expect.objectContaining({ prospecto_id: prospecto.body.id, contacto_nombre: "Laura Méndez", empresa_nombre: empresa }));

    const clasificada = await api().post("/api/v1/automatizacion/respuestas/clasificacion").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), respuesta_id: recibida.body.id, clasificacion: "interesado" });
    expect(clasificada.status).toBe(201);
    expect(clasificada.body).toEqual(expect.objectContaining({ clasificacion: "interesado", contacto_nombre: "Laura Méndez", empresa_nombre: empresa }));

    const ignorada = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), reply_to: "ventas@otra-cosa.test", canal: "correo", contenido: "spam" });
    expect(ignorada.status).toBe(200);
    expect(ignorada.body).toEqual(expect.objectContaining({ identificada: false, contacto_nombre: null, empresa_nombre: null }));
  });
});
