import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { envios } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Política de contactos (PLAN_N8N_DEFINITIVO.md): máximo 3 contactos y 5
// días hábiles de espera, contados POR PERSONA (contacto), no por
// prospecto. Antes se contaban por prospecto_id: si la misma persona
// volvía a entrar al flujo de ingesta con otro execution_id,
// registrarProspecto() reusaba el contacto pero creaba un prospecto nuevo
// en 0 envíos, y el límite se reiniciaba en silencio (hallazgo de la
// auditoría del workflow "PT1. ingesta y scoring", 22-sep-2026). Decisión
// de negocio (23-sep-2026): 3 por persona, y después de 6 meses sin
// contacto puede arrancar un ciclo nuevo.
describe("Envíos: límite de contactos y ventana de espera por persona", () => {
  let app: INestApplication;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  // Cada llamada con un execution_id distinto es un "reingreso" de la misma
  // persona si se repite el correo.
  async function registrarProspecto(correo: string) {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: "Empresa Prueba Envíos", giro: "tecnologia", tamano: "mediana" }, contacto: { nombre: "Persona Prueba", correo } });
    expect([200, 201]).toContain(res.status);
    return res.body as { id: number; contacto_id: number; duplicado: boolean };
  }

  function verificar(prospectoId: number) {
    return api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: prospectoId, canal: "correo" });
  }

  function registrarEnvio(prospectoId: number) {
    return api().post("/api/v1/automatizacion/envios").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" });
  }

  // Siembra un envío directo en BD con fecha y ventana controladas, para no
  // tener que esperar 5 días hábiles (o 6 meses) reales.
  async function sembrarEnvio(prospectoId: number, numeroContacto: number, enviadoEn: Date, ventanaEstado: "abierta" | "vencida" | "cerrada" = "vencida") {
    const ventanaVenceEn = new Date(enviadoEn.getTime() + 7 * 24 * 3600 * 1000);
    await db.insert(envios).values({ prospectoId, canal: "correo", numeroContacto, ventanaVenceEn, ventanaEstado, executionId: randomUUID(), enviadoEn });
  }

  function haceDias(dias: number) {
    return new Date(Date.now() - dias * 24 * 3600 * 1000);
  }

  function correoUnico() {
    return `persona.${randomUUID()}@envios.test`;
  }

  it("la misma persona reingresando con otro execution_id NO reinicia la ventana de espera", async () => {
    const correo = correoUnico();
    const p1 = await registrarProspecto(correo);

    const envio = await registrarEnvio(p1.id);
    expect(envio.status).toBe(201);

    const p2 = await registrarProspecto(correo);
    expect(p2.duplicado).toBe(true);
    expect(p2.id).not.toBe(p1.id);
    expect(p2.contacto_id).toBe(p1.contacto_id);

    const v = await verificar(p2.id);
    expect(v.status).toBe(200);
    expect(v.body.puede_enviar).toBe(false);
    expect(v.body.motivo).toBe("Ventana de espera activa");

    // Y si n8n se saltara la verificación, el registro también lo frena.
    const directo = await registrarEnvio(p2.id);
    expect(directo.status).toBe(409);
  });

  it("3 contactos repartidos entre varios prospectos de la misma persona agotan el límite", async () => {
    const correo = correoUnico();
    const p1 = await registrarProspecto(correo);
    const p2 = await registrarProspecto(correo);
    await sembrarEnvio(p1.id, 1, haceDias(30));
    await sembrarEnvio(p1.id, 2, haceDias(20));
    await sembrarEnvio(p2.id, 1, haceDias(10));

    const p3 = await registrarProspecto(correo);
    const v = await verificar(p3.id);
    expect(v.body.puede_enviar).toBe(false);
    expect(v.body.motivo).toBe("Máximo de 3 contactos alcanzado");

    const directo = await registrarEnvio(p3.id);
    expect(directo.status).toBe(409);
  });

  it("con 2 contactos previos (en otro prospecto) y ventana vencida, el siguiente es el contacto #3 de la persona", async () => {
    const correo = correoUnico();
    const p1 = await registrarProspecto(correo);
    await sembrarEnvio(p1.id, 1, haceDias(20));
    await sembrarEnvio(p1.id, 2, haceDias(10));

    const p2 = await registrarProspecto(correo);
    const v = await verificar(p2.id);
    expect(v.body.puede_enviar).toBe(true);
    expect(v.body.numero_en_ciclo_siguiente).toBe(3);

    const envio = await registrarEnvio(p2.id);
    expect(envio.status).toBe(201);
    expect(envio.body.numero_en_ciclo).toBe(3);
  });

  it("después de 6 meses sin contacto arranca un ciclo nuevo", async () => {
    const correo = correoUnico();
    const p1 = await registrarProspecto(correo);
    await sembrarEnvio(p1.id, 1, haceDias(230));
    await sembrarEnvio(p1.id, 2, haceDias(220));
    await sembrarEnvio(p1.id, 3, haceDias(210)); // ~7 meses

    const p2 = await registrarProspecto(correo);
    const v = await verificar(p2.id);
    expect(v.body.puede_enviar).toBe(true);
    expect(v.body.numero_en_ciclo_siguiente).toBe(1);

    const envio = await registrarEnvio(p2.id);
    expect(envio.status).toBe(201);
    expect(envio.body.numero_en_ciclo).toBe(1);
  });

  it("antes de 6 meses desde el último contacto sigue bloqueado", async () => {
    const correo = correoUnico();
    const p1 = await registrarProspecto(correo);
    await sembrarEnvio(p1.id, 1, haceDias(170));
    await sembrarEnvio(p1.id, 2, haceDias(160));
    await sembrarEnvio(p1.id, 3, haceDias(150)); // ~5 meses

    const p2 = await registrarProspecto(correo);
    const v = await verificar(p2.id);
    expect(v.body.puede_enviar).toBe(false);
    expect(v.body.motivo).toBe("Máximo de 3 contactos alcanzado");
  });

  it("el flujo normal de un solo prospecto sigue funcionando: recordatorio tras vencer la ventana", async () => {
    const p1 = await registrarProspecto(correoUnico());
    const primero = await registrarEnvio(p1.id);
    expect(primero.status).toBe(201);
    expect(primero.body.numero_contacto).toBe(1);

    // Lo que hace "Ventanas vencidas" al reclamar la fila.
    await db.update(envios).set({ ventanaEstado: "vencida" }).where(eq(envios.id, primero.body.id));

    const segundo = await registrarEnvio(p1.id);
    expect(segundo.status).toBe(201);
    expect(segundo.body.numero_contacto).toBe(2);
    expect(segundo.body.numero_en_ciclo).toBe(2);
  });

  it("ventanas vencidas: es_ultimo_contacto cuenta por persona y descarta envíos ya superados por otro prospecto", async () => {
    const correo = correoUnico();
    const p1 = await registrarProspecto(correo);
    const p2 = await registrarProspecto(correo);
    // Ventanas ya vencidas y todavía "abiertas": justo lo que reclama el poll.
    await sembrarEnvio(p1.id, 1, haceDias(30), "abierta");
    await sembrarEnvio(p1.id, 2, haceDias(20), "abierta");
    await sembrarEnvio(p2.id, 1, haceDias(10), "abierta");

    const res = await api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY).query({ limit: 100 });
    expect(res.status).toBe(200);

    const deEstaPersona = (res.body.data as Array<{ prospecto_id: number; es_ultimo_contacto: boolean; numero_en_ciclo: number }>).filter(
      (row) => row.prospecto_id === p1.id || row.prospecto_id === p2.id
    );
    // Solo el envío más reciente de la persona sigue siendo accionable; los
    // de p1 ya fueron superados por el de p2.
    expect(deEstaPersona).toHaveLength(1);
    expect(deEstaPersona[0].prospecto_id).toBe(p2.id);
    expect(deEstaPersona[0].numero_en_ciclo).toBe(3);
    expect(deEstaPersona[0].es_ultimo_contacto).toBe(true);

    // Los superados igual quedan reclamados, para que no regresen en el
    // siguiente poll.
    const restantes = await db.select({ estado: envios.ventanaEstado }).from(envios).where(eq(envios.prospectoId, p1.id));
    expect(restantes.every((row) => row.estado === "vencida")).toBe(true);
  });
});
