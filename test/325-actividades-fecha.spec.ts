import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Fecha de una actividad (D4 del plan de fixes, 2-oct-2026). Las
// actividades cuentan en "Desempeño por agente": con cualquier fecha, una
// llamada de "hace un año" o "del mes que viene" inflaba otro periodo.
// Ahora: entre hace 7 días y ahora (5 minutos de tolerancia por relojes
// adelantados).
describe("actividades: la fecha tiene que ser de los últimos 7 días", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;
  const DIA = 86_400_000;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const empresa = await request(app.getHttpServer()).post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa Actividades ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `act.${randomUUID()}@test.local` }] });
    empresaId = empresa.body.id as number;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const registrar = (ocurridaEn?: Date) =>
    request(app.getHttpServer()).post("/api/v1/actividades").set("Cookie", adminCookie).send({ empresaId, tipo: "llamada", resultado: "contestó", ocurridaEn: ocurridaEn?.toISOString() });

  it.each([
    ["sin fecha (ahora)", undefined, 201],
    ["hace 6 días", new Date(Date.now() - 6 * DIA), 201],
    ["dentro de 2 minutos (reloj adelantado)", new Date(Date.now() + 2 * 60_000), 201],
    ["hace 8 días", new Date(Date.now() - 8 * DIA), 400],
    ["mañana", new Date(Date.now() + DIA), 400]
  ] as const)("%s", async (_caso, fecha, status) => {
    expect((await registrar(fecha)).status).toBe(status);
  });
});
