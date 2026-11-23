import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, campanas, envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

type Fila = { envio_id: number; es_ultimo_contacto: boolean };

// #3 de la revisión del 20-nov-2026: /envios/vencidas marca la ventana como
// vencida al entregársela a PT4. Si PT4 truena antes de registrar el envío,
// el recordatorio se perdía. Ahora la API guarda cuándo la entregó y, si en 6
// horas no llegó su resultado, la vuelve a abrir (una sola vez).
describe("recordatorio entregado a PT4 que no llegó a mandarse", () => {
  let app: INestApplication;
  const db = testDb();
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function crearCampana(estado: "activa" | "finalizada") {
    const [result] = await db.insert(campanas).values({ nombre: `Campaña ${randomUUID()}`, estado });
    return result.insertId;
  }

  async function prospecto(estadoCampana: "activa" | "finalizada" = "activa") {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Retomado ${randomUUID()}`, giro: "manufactura" },
      contacto: { nombre: "Persona Retomada", correo: `retomado.${randomUUID()}@recordatorios.test` },
      campana_id: await crearCampana(estadoCampana)
    });
    expect([200, 201]).toContain(res.status);
    return res.body.id as number;
  }

  // Envíos 1..n de la persona; el último con la ventana ya vencida y abierta.
  async function sembrar(prospectoId: number, cuantos = 1) {
    let ultimo = 0;
    for (let n = 1; n <= cuantos; n++) {
      const enviadoEn = new Date(Date.now() - (30 - n) * 86_400_000);
      const [r] = await db.insert(envios).values({
        prospectoId,
        canal: "correo",
        numeroContacto: n,
        ventanaVenceEn: new Date(enviadoEn.getTime() + 7 * 86_400_000),
        ventanaEstado: n === cuantos ? "abierta" : "vencida",
        estado: "enviado",
        executionId: randomUUID(),
        enviadoEn
      });
      ultimo = r.insertId;
    }
    return ultimo;
  }

  const poll = async () => {
    const res = await api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY).query({ limit: 200 });
    expect(res.status).toBe(200);
    return res.body.data as Fila[];
  };
  const filaDe = async (id: number) => (await db.select().from(envios).where(eq(envios.id, id)))[0]!;
  // Simula que pasaron `horas` desde que se le entregó a PT4.
  const atrasarEntrega = (id: number, horas: number) => db.update(envios).set({ ventanaEntregadaEn: new Date(Date.now() - horas * 3_600_000) }).where(eq(envios.id, id));
  const retomas = (id: number) =>
    db.select().from(auditoria).where(and(eq(auditoria.entidad, "envio"), eq(auditoria.entidadId, id), eq(auditoria.accion, "retomar_recordatorio")));

  it("anota cuándo se entregó a PT4", async () => {
    const id = await sembrar(await prospecto());
    expect((await poll()).some((f) => f.envio_id === id)).toBe(true);
    const fila = await filaDe(id);
    expect(fila.ventanaEstado).toBe("vencida");
    expect(fila.ventanaEntregadaEn).toBeInstanceOf(Date);
    expect(fila.ventanaRetomas).toBe(0);
  });

  it("si en 6 horas no llegó el envío, PT4 lo vuelve a recibir, y solo una vez", async () => {
    const id = await sembrar(await prospecto());
    await poll();
    await atrasarEntrega(id, 7);

    expect((await poll()).some((f) => f.envio_id === id)).toBe(true);
    expect(await filaDe(id)).toEqual(expect.objectContaining({ ventanaEstado: "vencida", ventanaRetomas: 1 }));
    expect(await retomas(id)).toHaveLength(1);

    // Tampoco llegó la segunda vez: ya no se retoma.
    await atrasarEntrega(id, 7);
    expect((await poll()).some((f) => f.envio_id === id)).toBe(false);
    expect((await filaDe(id)).ventanaRetomas).toBe(1);
  });

  it("antes de 6 horas no se retoma", async () => {
    const id = await sembrar(await prospecto());
    await poll();
    await atrasarEntrega(id, 2);
    expect((await poll()).some((f) => f.envio_id === id)).toBe(false);
    expect((await filaDe(id)).ventanaEstado).toBe("vencida");
  });

  it("si PT4 sí registró el recordatorio, no se retoma", async () => {
    const p = await prospecto();
    const id = await sembrar(p);
    await poll();
    // PT4 registra con execution_id "recordatorio-<ventana>".
    await db.insert(envios).values({ prospectoId: p, canal: "correo", numeroContacto: 2, ventanaVenceEn: new Date(Date.now() + 5 * 86_400_000), executionId: `recordatorio-${id}` });
    await atrasarEntrega(id, 7);
    expect((await poll()).some((f) => f.envio_id === id)).toBe(false);
    expect((await filaDe(id)).ventanaRetomas).toBe(0);
  });

  it("el tercer contacto: se retoma si el prospecto sigue abierto, no si ya quedó inactivo", async () => {
    const abierto = await prospecto();
    const cerrado = await prospecto();
    const a = await sembrar(abierto, 3);
    const c = await sembrar(cerrado, 3);
    const primera = await poll();
    expect(primera.find((f) => f.envio_id === a)?.es_ultimo_contacto).toBe(true);

    // PT4 alcanzó a marcar inactivo a uno solo.
    await db.update(prospectos).set({ estado: "inactivo" }).where(eq(prospectos.id, cerrado));
    await atrasarEntrega(a, 7);
    await atrasarEntrega(c, 7);

    const segunda = await poll();
    expect(segunda.some((f) => f.envio_id === a)).toBe(true);
    expect(segunda.some((f) => f.envio_id === c)).toBe(false);
  });

  it("un prospecto que se cerró después (contestó, baja...) no se retoma", async () => {
    const p = await prospecto();
    const id = await sembrar(p);
    await poll();
    await db.update(prospectos).set({ estado: "interesado" }).where(eq(prospectos.id, p));
    await atrasarEntrega(id, 7);
    await poll();
    expect(await filaDe(id)).toEqual(expect.objectContaining({ ventanaEstado: "vencida", ventanaRetomas: 0 }));
  });

  it("la que la API canceló a propósito (campaña terminada) no cuenta como entregada", async () => {
    const id = await sembrar(await prospecto("finalizada"));
    await poll();
    expect(await filaDe(id)).toEqual(expect.objectContaining({ ventanaEstado: "vencida", ventanaEntregadaEn: null }));
    expect((await poll()).some((f) => f.envio_id === id)).toBe(false);
  });
});
