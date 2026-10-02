import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { loginFallos } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Trabajos diarios disparados por n8n (B5 del plan de fixes, 2-oct-2026).
// Con @Interval(24h) nunca corrían en Cloud Run: la instancia se apaga sola
// (minScale 0) y la CPU solo trabaja durante peticiones, así que el reloj
// de 24 h nunca llegaba. Ahora un workflow de n8n ("PT5. trabajos diarios")
// llama este endpoint cada día con la API key.
describe("trabajos diarios por endpoint (n8n)", () => {
  let app: INestApplication;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  function correr(job: string, apiKey: string | null = API_KEY) {
    const req = request(app.getHttpServer()).post(`/api/v1/automatizacion/jobs/${job}`);
    return apiKey ? req.set("X-API-Key", apiKey) : req;
  }

  it.each(["sla-tareas", "documentos-pendientes", "limpiar-borradores"])("%s: 200 con lo que procesó", async (job) => {
    const res = await correr(job);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ job, procesados: expect.any(Number) });
  });

  it("metricas-diarias calcula el día ANTERIOR en hora de México", async () => {
    const res = await correr("metricas-diarias");
    expect(res.status).toBe(200);
    expect(res.body.job).toBe("metricas-diarias");
    expect(res.body.fecha).toBe(fechaMx(new Date(Date.now() - 86_400_000)));
  });

  it("limpiar-borradores también borra los contadores viejos de login_fallos (no los bloqueos vigentes)", async () => {
    const viejo = `viejo.${randomUUID()}@test.local`;
    const bloqueado = `bloqueado.${randomUUID()}@test.local`;
    await db.insert(loginFallos).values({ correo: viejo, fallos: 3, ventanaInicio: sql`CURRENT_TIMESTAMP - INTERVAL 2 DAY` });
    await db.insert(loginFallos).values({ correo: bloqueado, fallos: 10, ventanaInicio: sql`CURRENT_TIMESTAMP - INTERVAL 2 DAY`, bloqueadoHasta: sql`CURRENT_TIMESTAMP + INTERVAL 10 MINUTE` });

    expect((await correr("limpiar-borradores")).status).toBe(200);

    expect(await db.select().from(loginFallos).where(eq(loginFallos.correo, viejo))).toHaveLength(0);
    expect(await db.select().from(loginFallos).where(eq(loginFallos.correo, bloqueado))).toHaveLength(1);
  });

  it("sin API key: 401; un trabajo que no existe: 404", async () => {
    expect((await correr("sla-tareas", null)).status).toBe(401);
    expect((await correr("no-existe")).status).toBe(404);
  });

  it("correrlo dos veces seguidas no truena (idempotente)", async () => {
    expect((await correr("metricas-diarias")).status).toBe(200);
    expect((await correr("metricas-diarias")).status).toBe(200);
  });
});
