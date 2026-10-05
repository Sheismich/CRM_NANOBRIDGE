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

// "La ventana se cierra por persona al recibir respuesta" (bloque "antes de
// encender", PLAN_N8N_DEFINITIVO.md). Los 3 contactos se cuentan por persona,
// no por prospecto: si la persona reingresó y su último correo salió con
// otro prospecto, una respuesta al correo anterior cerraba solo la ventana
// de ese prospecto (ya vencida) y la del último seguía abierta -- le llegaba
// el siguiente recordatorio aunque ya había contestado (5-oct-2026).
describe("respuestas: la ventana que se cierra es la de la persona", () => {
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

  async function registrarProspecto(correo: string) {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Ventana ${randomUUID()}` }, contacto: { nombre: "Persona Ventana", correo } });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function registrarEnvio(prospectoId: number) {
    const res = await api()
      .post("/api/v1/automatizacion/envios")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function ventana(envioId: number) {
    const [fila] = await db.select({ ventanaEstado: envios.ventanaEstado }).from(envios).where(eq(envios.id, envioId));
    return fila!.ventanaEstado;
  }

  it("contestar el correo de un prospecto anterior cierra la ventana abierta del último envío de la persona", async () => {
    const correo = `ventana.${randomUUID()}@persona.test`;
    const primero = await registrarProspecto(correo);
    const envio1 = await registrarEnvio(primero);
    // Su ventana venció y PT4 la reclamó (así queda tras /envios/vencidas).
    await db.update(envios).set({ ventanaEstado: "vencida" }).where(eq(envios.id, envio1));

    // La misma persona reingresa y su segundo correo sale con el prospecto nuevo.
    const segundo = await registrarProspecto(correo);
    expect(segundo).not.toBe(primero);
    const envio2 = await registrarEnvio(segundo);
    expect(await ventana(envio2)).toBe("abierta");

    // Contesta al PRIMER correo.
    const res = await api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: primero, canal: "correo", contenido: "Ya les contesté" });
    expect(res.status).toBeLessThan(300);

    expect(await ventana(envio2)).toBe("cerrada");
    // Tenía una ventana abierta: no es tardía.
    expect(res.body.tardia).toBe(false);
  });

  it("una respuesta automática (fuera de oficina) sigue sin cerrar nada", async () => {
    const correo = `ventana.${randomUUID()}@persona.test`;
    const primero = await registrarProspecto(correo);
    const envio1 = await registrarEnvio(primero);
    await db.update(envios).set({ ventanaEstado: "vencida" }).where(eq(envios.id, envio1));
    const segundo = await registrarProspecto(correo);
    const envio2 = await registrarEnvio(segundo);

    await api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: primero, canal: "correo", contenido: "Fuera de oficina", automatica: true });

    expect(await ventana(envio2)).toBe("abierta");
  });
});
