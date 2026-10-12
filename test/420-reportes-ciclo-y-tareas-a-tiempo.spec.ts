import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { oportunidades, tareas } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";

// Reportes del rediseño (bloque 4, 12-oct-2026): "Ciclo medio de venta: 28
// días" bajo la conversión por etapa, y "Se cierran a tiempo: 91% · 18 tareas
// resueltas esta semana" bajo las tareas por tipo.
describe("reportes: ciclo medio de venta y tareas a tiempo", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let empresaId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const hoy = fechaMx(new Date());
  const DIA = 86_400_000;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `rep.ciclo.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
    const emp = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Ciclo ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `ciclo.${randomUUID()}@test.local` }] });
    empresaId = emp.body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function ganadaTrasDias(dias: number) {
    const op = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Op ${randomUUID()}`, responsableId: agenteId });
    expect(op.status, JSON.stringify(op.body)).toBe(201);
    // Una hora de margen: MySQL redondea al segundo.
    await db.update(oportunidades).set({ creadoEn: new Date(Date.now() - dias * DIA - 3_600_000) }).where(eq(oportunidades.id, op.body.id));
    expect((await api().patch(`/api/v1/oportunidades/${op.body.id}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" })).status).toBe(200);
  }

  it("el ciclo medio de venta promedia los días de creada a ganada de lo que se ganó en el rango", async () => {
    await ganadaTrasDias(30);
    await ganadaTrasDias(20);
    // Una abierta no cuenta.
    await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Abierta ${randomUUID()}`, responsableId: agenteId });

    const res = await api().get("/api/v1/reportes/pipeline/conversion-etapas").set("Cookie", adminCookie).query({ responsableId: agenteId, fechaInicio: hoy, fechaFin: hoy });
    expect(res.status).toBe(200);
    expect(res.body.ciclo_medio_venta).toEqual({ dias: 25, ganadas: 2 });

    const sinGanadas = await api().get("/api/v1/reportes/pipeline/conversion-etapas").set("Cookie", adminCookie).query({ responsableId: agenteId, fechaInicio: "2020-01-01", fechaFin: "2020-01-31" });
    expect(sinGanadas.body.ciclo_medio_venta).toEqual({ dias: null, ganadas: 0 });
  });

  it("dice qué parte de las tareas cerradas se cerró a tiempo, cuántas se resolvieron esta semana y cuántas se crearon por tipo", async () => {
    async function tarea(tipo: string, fechaLimite: Date | null, cerrar: boolean) {
      const res = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Tarea ${randomUUID()}`, responsableId: agenteId, tipo });
      expect(res.status).toBe(201);
      await db.update(tareas).set({ fechaLimite }).where(eq(tareas.id, res.body.id));
      if (cerrar) expect((await api().patch(`/api/v1/tareas/${res.body.id}/cerrar`).set("Cookie", agenteCookie).send({ resultado: "Hecho" })).status).toBe(200);
    }
    await tarea("seguimiento", new Date(Date.now() + DIA), true); // a tiempo
    await tarea("seguimiento", new Date(Date.now() - DIA), true); // tarde
    await tarea("otro", null, true); // sin fecha límite: no entra al %
    await tarea("otro", null, false); // abierta

    const res = await api().get("/api/v1/reportes/tareas").set("Cookie", adminCookie).query({ responsableId: agenteId, fechaInicio: hoy, fechaFin: hoy });
    expect(res.status).toBe(200);
    expect(res.body.a_tiempo).toEqual({ a_tiempo: 1, con_fecha_limite: 2, pct: 50 });
    expect(res.body.cerradas_esta_semana).toBe(3);
    expect(res.body.creadas).toEqual({ total: 4, por_tipo: [{ tipo: "seguimiento", cantidad: 2 }, { tipo: "otro", cantidad: 2 }] });
  });
});
