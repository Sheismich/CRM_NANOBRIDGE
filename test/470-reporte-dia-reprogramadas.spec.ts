import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";
import { fechaMx } from "../src/shared/dia-habil.js";

// Reportes · Día (revisión del 15-oct-2026): mover la fecha límite de una
// tarea (PATCH /tareas/:id/reprogramar, Mi día) también es trabajo del día y
// sale en la bitácora, con la fecha nueva.
describe("reporte del día: tareas reprogramadas", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  const titulo = `Llamar reprogramada ${randomUUID().slice(0, 8)}`;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
    const creada = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo, responsableId: adminId, fechaLimite: new Date(Date.now() + 3_600_000).toISOString() });
    expect(creada.status).toBe(201);
    // Pasado mañana a las 10:00 de México (16:00 UTC).
    const nueva = new Date(Date.now() + 2 * 86_400_000);
    nueva.setUTCHours(16, 0, 0, 0);
    const rep = await api().patch(`/api/v1/tareas/${creada.body.id}/reprogramar`).set("Cookie", adminCookie).send({ fechaLimite: nueva.toISOString() });
    expect(rep.status).toBeLessThan(300);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("la bitácora trae tareas:reprogramada con quién y a qué fecha", async () => {
    const res = await api().get("/api/v1/reportes/dia").set("Cookie", adminCookie).query({ fecha: fechaMx(new Date()), tipo: "tareas", limit: 200 });
    expect(res.status).toBe(200);
    const mov = res.body.bitacora.data.find((m: { subtipo: string; texto: string }) => m.subtipo === "reprogramada" && m.texto.includes(titulo));
    expect(mov).toBeTruthy();
    expect(mov.tipo).toBe("tareas");
    expect(mov.usuario_id).toBe(adminId);
    expect(mov.texto).toMatch(/^movió “.+” al .+10:00/);
  });
});
