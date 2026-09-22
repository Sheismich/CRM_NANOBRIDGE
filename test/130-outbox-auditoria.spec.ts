import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, eventosPendientes, procesosFallidos } from "../src/database/schema.js";

// Cubre el hallazgo de la auditoría global del plan (18-sep-2026):
// PLAN_API_DEFINITIVO.md, "Reglas técnicas obligatorias", exige auditar
// "reintentos manuales" -- OutboxService.retry() y
// .actualizarEstadoProcesoFallido() no escribían nada en `auditoria` hasta
// ahora. Verifica que sí quede la fila (con antes/después correctos) en el
// camino feliz, y que un intento rechazado (409/404) NO deje rastro --
// ambos casos van dentro de la misma transacción que la validación.
describe("Auditoría de reintentos manuales (eventos_pendientes y procesos_fallidos)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const me = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    adminId = me.body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function auditoriaDe(entidad: string, entidadId: number) {
    return db.select().from(auditoria).where(eq(auditoria.entidad, entidad)).then((rows) => rows.filter((row) => row.entidadId === entidadId));
  }

  it("reintentar un evento fallido queda auditado con el estado anterior y el nuevo", async () => {
    const [seed] = await db.insert(eventosPendientes).values({
      eventoUuid: randomUUID(),
      tipo: "test_auditoria_retry",
      entidadTipo: "test",
      entidadId: 1,
      payload: { motivo: "prueba de auditoría" },
      estado: "fallido",
      intentos: 3,
      ultimoError: "N8N_WEBHOOK_URL no está configurado"
    });
    const eventoId = seed.insertId;

    const res = await request(app.getHttpServer()).post(`/api/v1/eventos-pendientes/${eventoId}/reintentar`).set("Cookie", adminCookie);
    expect(res.status).toBe(204);

    const filas = await auditoriaDe("evento_pendiente", eventoId);
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.usuarioId).toBe(adminId);
    expect(fila.accion).toBe("reintentar");
    expect(fila.antes).toMatchObject({ estado: "fallido", intentos: 3 });
    expect(fila.despues).toMatchObject({ estado: "pendiente", intentos: 0 });
  });

  it("reintentar un evento que NO está en 'fallido' responde 409 y no deja rastro en auditoría", async () => {
    const [seed] = await db.insert(eventosPendientes).values({
      eventoUuid: randomUUID(),
      tipo: "test_auditoria_retry_rechazado",
      entidadTipo: "test",
      entidadId: 2,
      payload: {},
      estado: "pendiente"
    });
    const eventoId = seed.insertId;

    const res = await request(app.getHttpServer()).post(`/api/v1/eventos-pendientes/${eventoId}/reintentar`).set("Cookie", adminCookie);
    expect(res.status).toBe(409);

    const filas = await auditoriaDe("evento_pendiente", eventoId);
    expect(filas).toHaveLength(0);
  });

  it("cambiar el estado de un proceso fallido queda auditado con el estado anterior y el nuevo", async () => {
    const [seed] = await db.insert(procesosFallidos).values({
      tipo: "test_auditoria_proceso_fallido",
      payload: { motivo: "prueba de auditoría" },
      mensaje: "fallo de prueba",
      estado: "abierto"
    });
    const procesoId = seed.insertId;

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/procesos-fallidos/${procesoId}/estado`)
      .set("Cookie", adminCookie)
      .send({ estado: "en_revision" });
    expect(res.status).toBe(200);

    const filas = await auditoriaDe("proceso_fallido", procesoId);
    expect(filas).toHaveLength(1);
    const fila = filas[0];
    expect(fila.usuarioId).toBe(adminId);
    expect(fila.accion).toBe("cambiar_estado");
    expect(fila.antes).toMatchObject({ estado: "abierto" });
    expect(fila.despues).toMatchObject({ estado: "en_revision" });
  });

  it("cambiar el estado de un proceso fallido inexistente responde 404 y no deja rastro en auditoría", async () => {
    const idInexistente = 9_999_999;

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/procesos-fallidos/${idInexistente}/estado`)
      .set("Cookie", adminCookie)
      .send({ estado: "resuelto" });
    expect(res.status).toBe(404);

    const filas = await auditoriaDe("proceso_fallido", idInexistente);
    expect(filas).toHaveLength(0);
  });
});
