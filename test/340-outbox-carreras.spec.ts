import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, ne } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { usarN8nQueRechaza } from "./support/n8n-que-rechaza.js";
import { eventosPendientes, procesosFallidos } from "../src/database/schema.js";
import { OutboxDispatcherService } from "../src/outbox/outbox-dispatcher.service.js";

// Carreras del outbox (code review de verificación, 5-oct-2026): una corrida
// atrasada (otra instancia de Cloud Run, o una que volvió a tomar el evento
// cuando su reclamo caducó) no puede pisar lo que otra corrida ya resolvió.
//
// N8N_WEBHOOK_URL apunta a una dirección que rechaza la conexión
// (test/support/n8n-que-rechaza.ts): dispatchOne() siempre falla, así que se usa
// para simular "la corrida atrasada que falló" sobre un evento cuya fila ya
// cambió en la base.
describe("Outbox: una corrida atrasada no pisa a otra", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let dispatcher: OutboxDispatcherService;
  const db = testDb();

  let restaurarN8n: () => void;

  beforeAll(async () => {
    restaurarN8n = usarN8nQueRechaza();
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    dispatcher = app.get(OutboxDispatcherService);
  });

  afterAll(async () => {
    restaurarN8n();
    await app.close();
    await closeTestDb();
  });

  async function sembrar(valores: Partial<typeof eventosPendientes.$inferInsert>) {
    const [seed] = await db.insert(eventosPendientes).values({
      eventoUuid: randomUUID(),
      tipo: "test_outbox_carrera",
      entidadTipo: "test",
      entidadId: 1,
      payload: {},
      ...valores
    });
    return seed.insertId;
  }

  async function leer(eventoId: number) {
    const [row] = await db.select().from(eventosPendientes).where(eq(eventosPendientes.id, eventoId));
    return row;
  }

  // Lo que la corrida atrasada leyó al reclamar el evento.
  async function corridaAtrasadaQueFalla(foto: typeof eventosPendientes.$inferSelect) {
    await (dispatcher as unknown as { dispatchOne(e: typeof foto): Promise<void> }).dispatchOne(foto);
  }

  it("un fallo atrasado no regresa a 'pendiente' un evento que otra corrida ya marcó 'enviado'", async () => {
    const id = await sembrar({ estado: "procesando", intentos: 0 });
    const foto = await leer(id);
    await db.update(eventosPendientes).set({ estado: "enviado" }).where(eq(eventosPendientes.id, id));

    await corridaAtrasadaQueFalla(foto);

    const evento = await leer(id);
    expect(evento.estado).toBe("enviado");
    expect(evento.intentos).toBe(0);
  });

  it("un último fallo atrasado no marca 'fallido' ni crea procesos_fallidos si otra corrida ya lo envió", async () => {
    const id = await sembrar({ estado: "procesando", intentos: 3 });
    const foto = await leer(id);
    await db.update(eventosPendientes).set({ estado: "enviado" }).where(eq(eventosPendientes.id, id));

    await corridaAtrasadaQueFalla(foto);

    expect((await leer(id)).estado).toBe("enviado");
    const fallidos = await db.select().from(procesosFallidos).where(eq(procesosFallidos.eventoId, id));
    expect(fallidos).toHaveLength(0);
  });

  it("un fallo atrasado no regresa el contador de intentos que otra corrida ya avanzó", async () => {
    const id = await sembrar({ estado: "procesando", intentos: 1 });
    const foto = await leer(id);
    // Mientras la corrida atrasada seguía esperando a n8n, otras corridas ya
    // fallaron y reintentaron: el evento va en su 3er intento, reclamado.
    await db.update(eventosPendientes).set({ intentos: 3 }).where(eq(eventosPendientes.id, id));

    await corridaAtrasadaQueFalla(foto);

    const evento = await leer(id);
    expect(evento.intentos).toBe(3);
    expect(evento.estado).toBe("procesando");
  });

  it("recupera un evento atorado en 'procesando' sin proximo_intento_en (de antes del Bloque B)", async () => {
    const id = await sembrar({ estado: "procesando", intentos: 0, proximoIntentoEn: null });
    // Fuera de turno los pendientes ajenos, para que este entre en la tanda.
    await db.update(eventosPendientes)
      .set({ proximoIntentoEn: new Date("2100-01-01T00:00:00Z") })
      .where(and(eq(eventosPendientes.estado, "pendiente"), ne(eventosPendientes.id, id)));

    const res = await request(app.getHttpServer()).post("/api/v1/eventos-pendientes/despachar").set("Cookie", adminCookie);
    expect(res.status).toBe(200);

    const evento = await leer(id);
    expect(evento.estado).toBe("pendiente");
    expect(evento.intentos).toBe(1);
  });
});
