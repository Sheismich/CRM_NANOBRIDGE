import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { cotizaciones } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";

// Fechas de México en reportes y cotizaciones (D3 del plan de fixes,
// 2-oct-2026). La conexión a MySQL corre en UTC: DATE(columna) y CURDATE()
// cambian de día a las 6 pm de México. Una llamada del lunes 7 pm contaba
// como del martes, y una cotización emitida en la tarde quedaba con la
// fecha de mañana.
describe("reportes y cotizaciones usan el día de México", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agente: { cookie: string[]; id: number };
  let empresaId: number;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const cookie = await crearAgente(app, adminCookie, `fechas.mx.${randomUUID()}@test.local`);
    agente = { cookie, id: (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number };
    const empresa = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal: `Empresa Fechas MX ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `fechas.mx.${randomUUID()}@test.local` }] });
    empresaId = empresa.body.id as number;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  it("una llamada de ayer a las 7 pm de México cuenta en el día de ayer, no en el de hoy", async () => {
    const ayer = fechaMx(new Date(Date.now() - 86_400_000));
    const hoy = fechaMx(new Date());
    // 19:00 de México = 01:00 UTC del día siguiente.
    const ocurridaEn = new Date(`${ayer}T19:00:00-06:00`);
    expect((await api().post("/api/v1/actividades").set("Cookie", agente.cookie).send({ empresaId, tipo: "llamada", resultado: "contestó", ocurridaEn: ocurridaEn.toISOString() })).status).toBe(201);

    const llamadasEl = async (dia: string) => {
      const res = await api().get("/api/v1/reportes/desempeno-por-agente").set("Cookie", adminCookie).query({ fechaInicio: dia, fechaFin: dia });
      expect(res.status).toBe(200);
      return (res.body as { responsable_id: number; actividades: { llamada: number } }[]).find((f) => f.responsable_id === agente.id)!.actividades.llamada;
    };
    expect(await llamadasEl(ayer)).toBe(1);
    expect(await llamadasEl(hoy)).toBe(0);
  });

  it("la fecha de emisión de una cotización es la de México", async () => {
    const op = await api().post("/api/v1/oportunidades").set("Cookie", agente.cookie).send({ empresaId, titulo: "Oportunidad fechas" });
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", agente.cookie).send({ empresaId, oportunidadId: op.body.id, partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 1 }] });
    expect(res.status).toBe(201);
    const [fila] = await db.select({ fechaEmision: cotizaciones.fechaEmision }).from(cotizaciones).where(eq(cotizaciones.id, res.body.id));
    expect(String(fila!.fechaEmision).slice(0, 10)).toBe(fechaMx(new Date()));
  });
});
