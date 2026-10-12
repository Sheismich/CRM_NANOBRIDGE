import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { tareas } from "../src/database/schema.js";
import { diaSiguiente, fechaMx, inicioDelDiaMxSql } from "../src/shared/dia-habil.js";

// Tareas · Mi día (ajuste del 11-oct-2026): el anillo "1/3 HOY" y el
// "3 completadas ayer" de arriba. Cuenta solo lo de quien pregunta, con los
// días en hora de México.
describe("tareas: conteos de Mi día", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const hoy = fechaMx(new Date());
  // Un minuto antes de que empiece un día de México (o sea, el día anterior).
  const minutoAntesDe = (fecha: string) => new Date(new Date(`${inicioDelDiaMxSql(fecha).replace(" ", "T")}Z`).getTime() - 60_000);

  async function crearTarea(responsableId: number) {
    const res = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Mi día ${randomUUID()}`, responsableId });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `mi.dia.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
    const adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;

    // Hoy: 1 cerrada y 2 abiertas que vencen hoy.
    const cerradaHoy = await crearTarea(agenteId);
    expect((await api().patch(`/api/v1/tareas/${cerradaHoy}/cerrar`).set("Cookie", agenteCookie).send({ resultado: "Listo" })).status).toBe(200);
    for (let i = 0; i < 2; i++) {
      const id = await crearTarea(agenteId);
      await db.update(tareas).set({ fechaLimite: minutoAntesDe(diaSiguiente(hoy)) }).where(eq(tareas.id, id));
    }
    // Ayer: 3 cerradas (a las 11:59 p.m. de México).
    for (let i = 0; i < 3; i++) {
      const id = await crearTarea(agenteId);
      await db.update(tareas).set({ estado: "cerrada", resultado: "Ayer", cerradaEn: minutoAntesDe(hoy) }).where(eq(tareas.id, id));
    }
    // Una abierta que venció ayer.
    const vencida = await crearTarea(agenteId);
    await db.update(tareas).set({ fechaLimite: minutoAntesDe(hoy) }).where(eq(tareas.id, vencida));
    // Una cancelada hoy no es "completada".
    const cancelada = await crearTarea(agenteId);
    await db.update(tareas).set({ estado: "cancelada", cerradaEn: new Date() }).where(eq(tareas.id, cancelada));
    // Lo de otra persona no cuenta.
    const ajena = await crearTarea(adminId);
    await db.update(tareas).set({ estado: "cerrada", resultado: "Otra", cerradaEn: new Date() }).where(eq(tareas.id, ajena));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("cuenta lo cerrado hoy y ayer, lo que vence hoy y lo vencido, solo de quien pregunta", async () => {
    const res = await api().get("/api/v1/tareas/conteos").set("Cookie", agenteCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cerradas_hoy: 1, cerradas_ayer: 3, pendientes_hoy: 2, vencidas: 1 });
  });
});
