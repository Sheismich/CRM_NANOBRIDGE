import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Revisión de la vista previa (15-oct-2026): había prospectos "Capturado"
// con correos registrados. n8n valida antes de mandar, pero la API no lo
// exigía. Ahora solo un prospecto validado recibe correos; como n8n
// registra el envío ANTES de mandarlo (para el reply_to firmado), un 409
// aquí detiene el correo.
describe("envíos: solo a prospectos validados", () => {
  let app: INestApplication;
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function prospecto(estado: "capturado" | "validado" | "excluido") {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Solo validados ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo: `solo.val.${randomUUID()}@prospeccion.test` }
    });
    await db.update(prospectos).set({ estado }).where(eq(prospectos.id, res.body.id));
    return res.body.id as number;
  }

  const registrar = (prospectoId: number) =>
    api().post("/api/v1/automatizacion/envios").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" });

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("un prospecto capturado (sin validar) no recibe correo: 409 PROSPECTO_NO_VALIDADO y no se guarda nada", async () => {
    const id = await prospecto("capturado");
    const res = await registrar(id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROSPECTO_NO_VALIDADO");
    expect(await db.select().from(envios).where(eq(envios.prospectoId, id))).toHaveLength(0);
  });

  it("un excluido tampoco", async () => {
    const res = await registrar(await prospecto("excluido"));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROSPECTO_NO_VALIDADO");
  });

  it("un validado sí", async () => {
    const res = await registrar(await prospecto("validado"));
    expect(res.status).toBe(201);
    expect(res.body.numero_contacto).toBe(1);
  });
});
