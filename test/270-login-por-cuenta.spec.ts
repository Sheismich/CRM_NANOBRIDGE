import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { Express } from "express";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { loginFallos } from "../src/database/schema.js";

// Freno de login POR CUENTA (B1 del plan de fixes, 2-oct-2026). El límite
// por IP vive en la memoria de cada instancia: en Cloud Run se reinicia con
// cada instancia nueva o deploy, cada instancia lleva el suyo, y basta con
// cambiar de IP para esquivarlo. Este segundo freno vive en MySQL y cuenta
// por correo: 10 fallos en 15 minutos bloquean esa cuenta 15 minutos, desde
// cualquier IP. Igual para correos que no existen (no revela cuáles son
// reales).
describe("login: freno por cuenta", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();
  let ipConsecutiva = 1;

  beforeAll(async () => {
    app = await createTestApp();
    // Cada intento llega con una IP distinta (X-Forwarded-For), para probar
    // el freno por cuenta sin chocar con el límite por IP.
    (app.getHttpAdapter().getInstance() as Express).set("trust proxy", 1);
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  function login(correo: string, password: string) {
    const ip = `10.0.${Math.floor(ipConsecutiva / 250)}.${(ipConsecutiva++ % 250) + 1}`;
    return request(app.getHttpServer()).post("/api/v1/auth/login").set("X-Forwarded-For", ip).send({ correo, password });
  }

  async function cuentaNueva() {
    const correo = `freno.${randomUUID()}@test.local`;
    await crearAgente(app, adminCookie, correo, "password_correcta_1");
    return correo;
  }

  async function fallar(correo: string, veces: number) {
    for (let i = 0; i < veces; i++) {
      expect((await login(correo, "password_incorrecta_1")).status).toBe(401);
    }
  }

  it("10 fallos desde IPs distintas bloquean la cuenta, aunque luego llegue la contraseña correcta", async () => {
    const correo = await cuentaNueva();
    await fallar(correo, 10);

    const res = await login(correo, "password_correcta_1");
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("CUENTA_BLOQUEADA_TEMPORALMENTE");
    expect(res.headers["retry-after"]).toBeDefined();
  });

  it("el bloqueo de una cuenta no afecta a otra", async () => {
    const bloqueada = await cuentaNueva();
    const otra = await cuentaNueva();
    await fallar(bloqueada, 10);
    expect((await login(otra, "password_correcta_1")).status).toBe(200);
  });

  it("un login correcto reinicia el contador", async () => {
    const correo = await cuentaNueva();
    await fallar(correo, 9);
    expect((await login(correo, "password_correcta_1")).status).toBe(200);
    await fallar(correo, 9);
    expect((await login(correo, "password_correcta_1")).status).toBe(200);
  });

  it("un correo que no existe se bloquea igual (no revela qué cuentas son reales)", async () => {
    const correo = `no.existe.${randomUUID()}@test.local`;
    await fallar(correo, 10);
    const res = await login(correo, "cualquier_password_1");
    expect(res.status).toBe(429);
    expect(res.body.code).toBe("CUENTA_BLOQUEADA_TEMPORALMENTE");
  });

  it("cuando pasa el bloqueo, la cuenta vuelve a entrar", async () => {
    const correo = await cuentaNueva();
    await fallar(correo, 10);
    expect((await login(correo, "password_correcta_1")).status).toBe(429);

    await db.update(loginFallos).set({ bloqueadoHasta: new Date(Date.now() - 1000) }).where(eq(loginFallos.correo, correo));
    expect((await login(correo, "password_correcta_1")).status).toBe(200);
  });
});
