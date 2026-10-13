import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, tareas } from "../src/database/schema.js";

// Mi día (rediseño, 13-oct-2026): "Reprogramar" cambia la fecha límite de
// una tarea abierta. Quien la tiene la mueve (un agente, solo las suyas);
// la nueva fecha tiene que ser futura; queda en la auditoría y en el
// historial; y si ya se había avisado que venció, el aviso se rearma para
// la fecha nueva.
describe("tareas: reprogramar", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let otroAgenteCookie: string[];
  let agenteId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const enDias = (dias: number) => new Date(Date.now() + dias * 86_400_000).toISOString();

  async function crearTarea(fechaLimite?: string) {
    const res = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Reprogramable ${randomUUID()}`, responsableId: agenteId, fechaLimite });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `reprog.${Date.now()}@test.local`);
    otroAgenteCookie = await crearAgente(app, adminCookie, `reprog.otro.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("el responsable la mueve a una fecha futura y queda auditado y en el historial", async () => {
    const id = await crearTarea(enDias(-1));
    const nueva = enDias(3);
    const res = await api().patch(`/api/v1/tareas/${id}/reprogramar`).set("Cookie", agenteCookie).send({ fechaLimite: nueva });
    expect(res.status).toBe(200);
    expect(new Date(res.body.fecha_limite).getTime()).toBeCloseTo(new Date(nueva).getTime(), -4);

    const [fila] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "tarea"), eq(auditoria.entidadId, id), eq(auditoria.accion, "reprogramar")));
    expect(fila).toBeTruthy();
    expect((fila.antes as { fecha_limite: string }).fecha_limite).toBeTruthy();

    const historial = await api().get(`/api/v1/tareas/${id}/historial`).set("Cookie", agenteCookie);
    expect(historial.body[0]).toEqual(expect.objectContaining({ tipo: "reprogramada", usuario_nombre: "Agente de prueba" }));
    expect(historial.body[0].fecha_limite).toBeTruthy();
  });

  it("si ya se avisó que venció, el aviso se rearma para la fecha nueva", async () => {
    const id = await crearTarea(enDias(-2));
    await db.update(tareas).set({ alertadoEn: new Date() }).where(eq(tareas.id, id));
    await api().patch(`/api/v1/tareas/${id}/reprogramar`).set("Cookie", adminCookie).send({ fechaLimite: enDias(1) });
    const [t] = await db.select({ alertadoEn: tareas.alertadoEn }).from(tareas).where(eq(tareas.id, id));
    expect(t.alertadoEn).toBeNull();
  });

  it("rechaza una fecha pasada", async () => {
    const id = await crearTarea(enDias(1));
    const res = await api().patch(`/api/v1/tareas/${id}/reprogramar`).set("Cookie", agenteCookie).send({ fechaLimite: enDias(-1) });
    expect(res.status).toBe(400);
  });

  it("un agente no mueve tareas ajenas y nadie mueve una cerrada", async () => {
    const id = await crearTarea(enDias(1));
    const ajena = await api().patch(`/api/v1/tareas/${id}/reprogramar`).set("Cookie", otroAgenteCookie).send({ fechaLimite: enDias(2) });
    expect(ajena.status).toBe(404);

    await api().patch(`/api/v1/tareas/${id}/cerrar`).set("Cookie", agenteCookie).send({ resultado: "Listo" });
    const cerrada = await api().patch(`/api/v1/tareas/${id}/reprogramar`).set("Cookie", adminCookie).send({ fechaLimite: enDias(2) });
    expect(cerrada.status).toBe(409);
  });
});
