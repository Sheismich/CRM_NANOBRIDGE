import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, procesosFallidos } from "../src/database/schema.js";

// Cambiar el estado de un proceso fallido queda en `auditoria`; un intento
// rechazado no deja rastro.
describe("Auditoría de procesos fallidos", () => {
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
