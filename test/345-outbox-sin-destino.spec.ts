import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { eventosPendientes, procesosFallidos } from "../src/database/schema.js";

// Sin N8N_WEBHOOK_URL (B3 todavía no existe en n8n) el despachador no tiene a
// quién entregar. Antes lo intentaba, gastaba los 4 intentos y cada evento
// (prospecto_clasificado, tarea_cerrada, alertas diarias) terminaba en
// procesos_fallidos: ese ruido escondía los errores reales que reporta B4.
// Ahora no toca nada: los eventos esperan en 'pendiente' y salen cuando se
// configure la URL (pendiente #3 de PLAN_N8N_DEFINITIVO.md, 7-oct-2026).
// N8N_WEBHOOK_URL="" en pruebas (test/setup/setup-env.ts).
describe("outbox sin N8N_WEBHOOK_URL: los eventos esperan", () => {
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

  it("despachar no reclama ni falla el evento: sigue 'pendiente', sin intentos y sin procesos_fallidos", async () => {
    const [seed] = await db.insert(eventosPendientes).values({
      eventoUuid: randomUUID(),
      tipo: "test_outbox_sin_destino",
      entidadTipo: "test",
      entidadId: 1,
      payload: { motivo: "sin destino" }
    });
    const eventoId = seed.insertId;

    const res = await request(app.getHttpServer()).post("/api/v1/eventos-pendientes/despachar").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ procesados: 0, sin_destino: true });

    const [evento] = await db.select().from(eventosPendientes).where(eq(eventosPendientes.id, eventoId));
    expect(evento!.estado).toBe("pendiente");
    expect(evento!.intentos).toBe(0);
    expect(evento!.ultimoError).toBeNull();
    expect(evento!.proximoIntentoEn).toBeNull();

    const procesos = await db.select().from(procesosFallidos).where(eq(procesosFallidos.eventoId, eventoId));
    expect(procesos).toHaveLength(0);
  });
});
