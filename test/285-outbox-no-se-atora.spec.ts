import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { eventosPendientes } from "../src/database/schema.js";

// Un evento del outbox no se queda atorado (B4 del plan de fixes,
// 2-oct-2026). El despachador marca 'procesando' ANTES de enviar: si Cloud
// Run apagaba la instancia a medio envío, el evento se quedaba en
// 'procesando' para siempre (el despachador solo buscaba 'pendiente' y
// "reintentar" solo acepta 'fallido'). Ahora el reclamo caduca: un
// 'procesando' cuyo proximo_intento_en ya pasó se vuelve a tomar.
//
// N8N_WEBHOOK_URL="" en pruebas: cada entrega falla de forma determinista
// (ver 50-outbox-dispatcher-retry), lo que basta para ver si el evento se
// tomó o no.
describe("outbox: un evento abandonado no se queda atorado", () => {
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

  async function sembrar(estado: "pendiente" | "procesando", proximoIntentoEn: Date | null) {
    const [seed] = await db.insert(eventosPendientes).values({ eventoUuid: randomUUID(), tipo: "test_outbox_atorado", entidadTipo: "test", entidadId: 1, payload: {}, estado, proximoIntentoEn });
    return seed.insertId;
  }

  // Saca de turno los eventos de otros archivos (base compartida).
  async function aislar() {
    await db.update(eventosPendientes)
      .set({ proximoIntentoEn: new Date("2100-01-01T00:00:00Z") })
      .where(and(inArray(eventosPendientes.estado, ["pendiente", "procesando"]), ne(eventosPendientes.tipo, "test_outbox_atorado")));
  }

  async function despachar() {
    const res = await request(app.getHttpServer()).post("/api/v1/eventos-pendientes/despachar").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  }

  async function leer(id: number) {
    const [row] = await db.select().from(eventosPendientes).where(eq(eventosPendientes.id, id));
    return row!;
  }

  it("un 'procesando' cuyo reclamo ya caducó se vuelve a tomar (y aquí falla y queda pendiente con su backoff)", async () => {
    const id = await sembrar("procesando", new Date(0));
    await aislar();

    await despachar();

    const evento = await leer(id);
    expect(evento.estado).toBe("pendiente");
    expect(evento.intentos).toBe(1);
    expect(evento.ultimoError).toMatch(/N8N_WEBHOOK_URL/);
  });

  it("un 'procesando' recién reclamado por otra instancia (reclamo vigente) no se toca", async () => {
    const id = await sembrar("procesando", new Date(Date.now() + 10 * 60_000));
    await aislar();

    await despachar();

    const evento = await leer(id);
    expect(evento.estado).toBe("procesando");
    expect(evento.intentos).toBe(0);
  });
});
