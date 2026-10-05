import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";

// Acentos y eñes de ida y vuelta (5-oct-2026): el nombre del primer admin
// salió "Fabi�n" en producción. Fue el comando con que se creó (la terminal
// mandó otra codificación), no la API; este test deja constancia de que la
// API guarda y devuelve el texto tal cual.
describe("acentos: lo que se guarda es lo que se lee", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it("nombre de usuario, empresa y contacto con acentos, eñes y diéresis", async () => {
    const api = () => request(app.getHttpServer());
    const nombreUsuario = "Fabián Núñez Güereña";
    const usuario = await api().post("/api/v1/usuarios").set("Cookie", adminCookie)
      .send({ nombre: nombreUsuario, correo: `acentos.${randomUUID()}@test.local`, password: "password_acentos_1", rol: "agente" });
    expect(usuario.status).toBe(201);
    const lista = await api().get("/api/v1/usuarios").query({ limit: 100 }).set("Cookie", adminCookie);
    expect(lista.body.data.some((u: { nombre: string }) => u.nombre === nombreUsuario)).toBe(true);

    const nombreEmpresa = `Compañía Ñandú y Asociación ${randomUUID().slice(0, 8)}`;
    const empresa = await api().post("/api/v1/empresas").set("Cookie", adminCookie)
      .send({ nombreLegal: nombreEmpresa, contactos: [{ nombre: "José Ángel Peña", correo: `acentos.${randomUUID()}@test.local` }] });
    expect(empresa.status).toBe(201);
    const ficha = await api().get(`/api/v1/empresas/${empresa.body.id}`).set("Cookie", adminCookie);
    expect(ficha.body.nombre_legal).toBe(nombreEmpresa);
    expect(JSON.stringify(ficha.body)).toContain("José Ángel Peña");
  });
});
