import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { respuestas } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Flujo de B2 (PLAN_N8N_DEFINITIVO.md) desde que llega una respuesta hasta
// que queda clasificada, sea por n8n (POST /automatizacion/respuestas/
// clasificacion) o a mano desde la cola de clasificación del CRM, cuando n8n
// la marcó "ambigua". Ninguno de estos endpoints tenía cobertura propia.
describe("respuestas: clasificación automática y manual", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function registrarProspecto(correo = `respuesta.${randomUUID()}@respuestas.test`) {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Respuestas ${randomUUID()}` }, contacto: { nombre: "Persona Respuesta", correo } });
    expect(res.status).toBe(201);
    return { id: res.body.id as number, correo };
  }

  async function registrarRespuesta(prospectoId: number, contenido = "Gracias por escribir") {
    const res = await api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function clasificarAutomatica(respuestaId: number, clasificacion: string) {
    return api()
      .post("/api/v1/automatizacion/respuestas/clasificacion")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion });
  }

  describe("tarea de clasificación ligada a su respuesta", () => {
    it("una respuesta 'ambigua' crea una tarea de clasificación que apunta a esa respuesta (respuesta_id)", async () => {
      const prospecto = await registrarProspecto();
      await registrarRespuesta(prospecto.id, "primera respuesta, ya resuelta");
      const respuestaId = await registrarRespuesta(prospecto.id, "¿de qué se trata?");

      const res = await clasificarAutomatica(respuestaId, "ambigua");
      expect(res.status).toBe(201);
      expect(res.body.tarea_id).toEqual(expect.any(Number));

      const tarea = await api().get(`/api/v1/tareas/${res.body.tarea_id}`).set("Cookie", adminCookie);
      expect(tarea.status).toBe(200);
      expect(tarea.body.tipo).toBe("clasificacion");
      expect(tarea.body.prospecto_id).toBe(prospecto.id);
      expect(tarea.body.respuesta_id).toBe(respuestaId);
    });

    it("respuestas.clasificacion admite los valores que solo usa la clasificación manual (invalido, reagendar)", async () => {
      const prospecto = await registrarProspecto();
      const respuestaId = await registrarRespuesta(prospecto.id);

      for (const valor of ["invalido", "reagendar"] as const) {
        await db.update(respuestas).set({ clasificacion: valor }).where(eq(respuestas.id, respuestaId));
        const [fila] = await db.select({ clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, respuestaId));
        expect(fila!.clasificacion).toBe(valor);
      }
    });
  });
});
