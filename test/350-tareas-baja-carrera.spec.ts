import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { tareas } from "../src/database/schema.js";
import type { DrizzleTx } from "../src/database/drizzle.constants.js";
import { darDeBajaPersona } from "../src/shared/baja-prospecto.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Carrera entre crear un seguimiento y la baja de la persona (code review de
// verificación, 5-oct-2026): "¿está en baja?" se revisaba fuera de la
// transacción, sin bloqueo. Si la baja se confirmaba justo después, la tarea
// nacía DESPUÉS de que la baja ya había cancelado las suyas y se quedaba
// abierta: un vendedor contactando a quien pidió que no.
describe("tareas: la baja de la persona contra un seguimiento que se está creando", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function prospectoNuevo() {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Carrera ${randomUUID()}` }, contacto: { nombre: "Persona Carrera", correo: `carrera.${randomUUID()}@baja.test` } });
    expect(res.status).toBe(201);
    return { prospectoId: res.body.id as number, contactoId: res.body.contacto_id as number, empresaId: res.body.empresa_id as number };
  }

  // Abre la baja de la persona, lanza `peticion` mientras la baja sigue sin
  // confirmar, confirma la baja y devuelve la respuesta de la petición.
  async function mientrasSeDaDeBaja(contactoId: number, peticion: () => request.Test) {
    let pendiente!: Promise<request.Response>;
    await db.transaction(async (tx) => {
      await darDeBajaPersona(tx as unknown as DrizzleTx, contactoId, { accion: "cambiar_estado_automatizacion", motivo: "prueba de carrera", executionId: null, usuarioId: null });
      pendiente = peticion().then((res) => res);
      await new Promise((resolve) => setTimeout(resolve, 800));
    });
    return pendiente;
  }

  it("POST /tareas: un seguimiento creado mientras la baja se confirma responde 409 PERSONA_EN_BAJA", async () => {
    const { prospectoId, contactoId } = await prospectoNuevo();
    const res = await mientrasSeDaDeBaja(contactoId, () => api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ tipo: "seguimiento", titulo: "Llamarle", responsableId: adminId, prospectoId }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PERSONA_EN_BAJA");
  });

  it("POST /automatizacion/tareas: un seguimiento creado mientras la baja se confirma se omite", async () => {
    const { prospectoId, contactoId } = await prospectoNuevo();
    const res = await mientrasSeDaDeBaja(contactoId, () => api().post("/api/v1/automatizacion/tareas").set("X-API-Key", API_KEY).send({ execution_id: `carrera-${randomUUID()}`, tipo: "seguimiento", titulo: "Contactar", prospecto_id: prospectoId }));
    expect(res.body).toMatchObject({ id: null, omitida: "prospecto_en_baja" });
  });

  it("la baja cancela también los seguimientos ligados solo al contacto (sin prospecto)", async () => {
    const { contactoId, empresaId } = await prospectoNuevo();
    const creada = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ tipo: "seguimiento", titulo: "Llamarle sin prospecto", responsableId: adminId, empresaId, contactoId });
    expect(creada.status).toBe(201);

    await db.transaction(async (tx) => {
      await darDeBajaPersona(tx as unknown as DrizzleTx, contactoId, { accion: "cambiar_estado_automatizacion", motivo: "prueba", executionId: null, usuarioId: null });
    });

    const [tarea] = await db.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, creada.body.id));
    expect(tarea.estado).toBe("cancelada");
  });
});
