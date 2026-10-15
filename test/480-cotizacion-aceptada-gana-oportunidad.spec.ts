import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Decisión de Fabián (15-oct-2026): al aceptar una cotización su
// oportunidad pasa sola a "Ganada", y su valor pasa a ser el total aceptado
// (lo que de verdad se vendió); el estimado anterior queda en el historial.
describe("cotización aceptada → oportunidad ganada", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const empresa = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa Gana ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `gana.${randomUUID()}@test.local` }] });
    empresaId = empresa.body.id as number;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function oportunidad(valorEstimado: number) {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Oportunidad gana ${randomUUID()}`, valorEstimado });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function enviada(oportunidadId: number, precio: number) {
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: precio }] });
    expect(res.status).toBe(201);
    expect((await estado(res.body.id, "enviada")).status).toBe(200);
    return res.body.id as number;
  }

  const estado = (id: number, nuevo: string, extra: Record<string, string> = {}) => api().patch(`/api/v1/cotizaciones/${id}/estado`).set("Cookie", adminCookie).send({ estado: nuevo, ...extra });
  const verOportunidad = async (id: number) => (await api().get(`/api/v1/oportunidades/${id}`).set("Cookie", adminCookie)).body;

  it("aceptar marca la oportunidad Ganada, cerrada, con el total aceptado como valor y una línea en el historial", async () => {
    const op = await oportunidad(1000);
    const cot = await enviada(op, 1500);
    expect((await estado(cot, "aceptada")).status).toBe(200);

    const o = await verOportunidad(op);
    expect(o.etapa_clave).toBe("ganada");
    expect(o.cerrada).toBe(true);
    expect(Number(o.valor_estimado)).toBe(1500);
    const ultima = o.historial[o.historial.length - 1];
    expect(ultima.etapa_clave).toBe("ganada");
    expect(ultima.comentario).toMatch(/cotización v1 aceptada/i);
    expect(ultima.comentario).toMatch(/1,000/);
  });

  it("rechazar no toca la oportunidad", async () => {
    const op = await oportunidad(800);
    const cot = await enviada(op, 900);
    expect((await estado(cot, "rechazada", { motivoRechazo: "precio" })).status).toBe(200);
    const o = await verOportunidad(op);
    expect(o.cerrada).toBe(false);
    expect(Number(o.valor_estimado)).toBe(800);
  });

  it("una vez ganada, otra cotización de esa oportunidad ya no se puede aceptar", async () => {
    const op = await oportunidad(500);
    const [a, b] = [await enviada(op, 500), await enviada(op, 450)];
    expect((await estado(a, "aceptada")).status).toBe(200);
    expect((await estado(b, "aceptada")).status).toBe(409);
  });
});
