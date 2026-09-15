import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { eventosPendientes, procesosFallidos } from "../src/database/schema.js";

// Cubre OutboxDispatcherService.handleFailure() (outbox-dispatcher.service.ts):
// backoff 5s/30s/120s (3 reintentos DESPUÉS del intento inicial, 4 intentos
// en total) y que el 4° fallo consecutivo agota reintentos, marca el evento
// 'fallido' y crea la fila en procesos_fallidos.
//
// N8N_WEBHOOK_URL="" en el entorno de pruebas (ver test/setup/setup-env.ts)
// -- deliver() SIEMPRE truena con "N8N_WEBHOOK_URL no está configurado", así
// que cada corrida del despachador sobre el evento sembrado aquí falla de
// forma determinista, sin necesitar un receptor HTTP de prueba.
//
// En vez de esperar los 5s/30s/120s reales (harían esta sola prueba más
// lenta que TODA la suite junta), se siembra el evento y se "adelanta el
// reloj" escribiendo directo en proximo_intento_en vía test/support/db.ts
// entre cada llamada a POST /despachar -- el backoff en sí (qué tan lejos
// en el futuro se programa) sí se verifica leyendo la columna real después
// de cada fallo, solo no se espera a que llegue esa hora.
describe("OutboxDispatcherService: reintentos con backoff", () => {
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

  async function forzarElegibleAhora(eventoId: number) {
    // epoch (muy en el pasado) en vez de "ahora mismo": evita cualquier
    // problema de milisegundos/zona horaria entre el reloj de Node y el de
    // MySQL -- siempre queda <= CURRENT_TIMESTAMP.
    await db.update(eventosPendientes).set({ proximoIntentoEn: new Date(0) }).where(eq(eventosPendientes.id, eventoId));
  }

  async function despachar() {
    const res = await request(app.getHttpServer()).post("/api/v1/eventos-pendientes/despachar").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
  }

  async function leerEvento(eventoId: number) {
    const [row] = await db.select().from(eventosPendientes).where(eq(eventosPendientes.id, eventoId));
    if (!row) throw new Error(`Evento ${eventoId} no encontrado`);
    return row;
  }

  it("agota los 3 reintentos con backoff creciente y termina en 'fallido' + procesos_fallidos", async () => {
    const [seed] = await db.insert(eventosPendientes).values({
      tipo: "test_outbox_retry",
      entidadTipo: "test",
      entidadId: 1,
      payload: { motivo: "prueba de backoff" }
    });
    const eventoId = seed.insertId;

    // Intento 1: proximoIntentoEn arranca NULL -> ya es elegible sin forzar nada.
    await despachar();
    let evento = await leerEvento(eventoId);
    expect(evento.estado).toBe("pendiente");
    expect(evento.intentos).toBe(1);
    expect(evento.ultimoError).toMatch(/N8N_WEBHOOK_URL/);
    let proximo = new Date(evento.proximoIntentoEn!).getTime();
    let ahora = Date.now();
    expect(proximo).toBeGreaterThan(ahora + 3_000);
    expect(proximo).toBeLessThan(ahora + 10_000);

    // Intento 2 (backoff 30s).
    await forzarElegibleAhora(eventoId);
    await despachar();
    evento = await leerEvento(eventoId);
    expect(evento.estado).toBe("pendiente");
    expect(evento.intentos).toBe(2);
    proximo = new Date(evento.proximoIntentoEn!).getTime();
    ahora = Date.now();
    expect(proximo).toBeGreaterThan(ahora + 25_000);
    expect(proximo).toBeLessThan(ahora + 35_000);

    // Intento 3 (backoff 120s).
    await forzarElegibleAhora(eventoId);
    await despachar();
    evento = await leerEvento(eventoId);
    expect(evento.estado).toBe("pendiente");
    expect(evento.intentos).toBe(3);
    proximo = new Date(evento.proximoIntentoEn!).getTime();
    ahora = Date.now();
    expect(proximo).toBeGreaterThan(ahora + 110_000);
    expect(proximo).toBeLessThan(ahora + 130_000);

    // Intento 4 (el 3er reintento): ya no hay más backoff -- agota
    // reintentos, queda 'fallido' y se crea la fila en procesos_fallidos.
    await forzarElegibleAhora(eventoId);
    await despachar();
    evento = await leerEvento(eventoId);
    expect(evento.estado).toBe("fallido");
    expect(evento.intentos).toBe(4);

    const [proceso] = await db.select().from(procesosFallidos).where(eq(procesosFallidos.eventoId, eventoId));
    expect(proceso).toBeDefined();
    expect(proceso.tipo).toBe("test_outbox_retry");
    expect(proceso.mensaje).toMatch(/N8N_WEBHOOK_URL/);
  });
});
