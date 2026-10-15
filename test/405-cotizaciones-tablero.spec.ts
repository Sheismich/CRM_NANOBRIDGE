import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, cotizaciones } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";
import { CLAVES_MOTIVO_RECHAZO } from "../src/shared/motivos-rechazo-cotizacion.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Cotizaciones del rediseño (bloque 2, 12-oct-2026): tablero por estado con
// conteos y tasa de aceptación, "sin respuesta hace N días" / "vence en N
// días", motivo de rechazo, segunda línea de cada partida y vencidas que se
// marcan solas sin quedar bloqueadas.
describe("cotizaciones: tablero, motivo de rechazo y vencidas", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agente2Cookie: string[];
  let agente2Id: number;
  let empresaId: number;
  let empresa2Id: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const hoy = fechaMx(new Date());

  function sumarDias(fecha: string, dias: number) {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  async function crearEmpresa(nombreLegal: string) {
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal, contactos: [{ nombre: "Ana Cotiza", puesto: "Compras", correo: `cot.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function oportunidad(empresa: number, responsableId: number) {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId: empresa, titulo: `Oportunidad ${marca} ${randomUUID().slice(0, 4)}`, responsableId });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  // Total = precio (cantidad 1, sin impuestos).
  async function cotizacion(empresa: number, oportunidadId: number, precio: number, extra: Record<string, unknown> = {}) {
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId: empresa, oportunidadId, partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: precio }], ...extra });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function estado(id: number, nuevo: string, extra: Record<string, unknown> = {}) {
    return api().patch(`/api/v1/cotizaciones/${id}/estado`).set("Cookie", adminCookie).send({ estado: nuevo, ...extra });
  }

  async function enviada(empresa: number, oportunidadId: number, precio: number, extra: Record<string, unknown> = {}) {
    const id = await cotizacion(empresa, oportunidadId, precio, extra);
    expect((await estado(id, "enviada")).status).toBe(200);
    return id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `cot.tablero.${Date.now()}@test.local`);
    agente2Cookie = await crearAgente(app, adminCookie, `cot.tablero2.${Date.now()}@test.local`);
    agente2Id = (await api().get("/api/v1/auth/me").set("Cookie", agente2Cookie)).body.id;
    empresaId = await crearEmpresa(`Moldes ${marca} SA`);
    empresa2Id = await crearEmpresa(`Tablero ${marca} SA`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("motivo de rechazo", () => {
    let agenteId: number;
    let opId: number;
    beforeAll(async () => {
      agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
      opId = await oportunidad(empresaId, agenteId);
    });

    // Día del cambio (15-oct-2026): el front nuevo siempre pide el motivo.
    it("rechazar sin motivo ya no se puede: 400", async () => {
      const id = await enviada(empresaId, opId, 100);
      const res = await estado(id, "rechazada");
      expect(res.status).toBe(400);
    });

    it("con motivo lo guarda, lo audita y sale en el detalle; 'otro' pide explicación", async () => {
      const id = await enviada(empresaId, opId, 100);
      expect((await estado(id, "rechazada", { motivoRechazo: "otro" })).status).toBe(400);
      const res = await estado(id, "rechazada", { motivoRechazo: "precio", motivoRechazoDetalle: "Les pareció caro" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ motivo_rechazo: "precio", motivo_rechazo_detalle: "Les pareció caro" }));
      const [fila] = await db.select({ despues: auditoria.despues }).from(auditoria)
        .where(and(eq(auditoria.entidad, "cotizacion"), eq(auditoria.entidadId, id), eq(auditoria.accion, "cambiar_estado")))
        .orderBy(sql`${auditoria.id} DESC`).limit(1);
      expect(fila!.despues).toEqual(expect.objectContaining({ estado: "rechazada", motivo_rechazo: "precio", motivo_rechazo_detalle: "Les pareció caro" }));
    });

    it("un motivo con otro estado que no es 'rechazada' es 400", async () => {
      const id = await enviada(empresaId, opId, 100);
      expect((await estado(id, "aceptada", { motivoRechazo: "precio" })).status).toBe(400);
    });

    it("la lista de motivos sale del back y coincide con el ENUM de la base", async () => {
      const res = await api().get("/api/v1/cotizaciones/motivos-rechazo").set("Cookie", agenteCookie);
      expect(res.status).toBe(200);
      expect(res.body.map((m: { clave: string }) => m.clave)).toEqual([...CLAVES_MOTIVO_RECHAZO]);
      expect(res.body[0]).toEqual({ clave: "precio", nombre: "Precio" });
      const [filas] = await db.execute(sql`SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cotizaciones' AND COLUMN_NAME = 'motivo_rechazo'`);
      const tipo = (filas as unknown as { tipo: string }[])[0]!.tipo;
      expect([...tipo.matchAll(/'([^']*)'/g)].map((m) => m[1])).toEqual([...CLAVES_MOTIVO_RECHAZO]);
    });
  });

  it("cada partida guarda su segunda línea y el detalle dice para quién y de qué oportunidad es", async () => {
    const agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
    const opId = await oportunidad(empresaId, agenteId);
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({
      empresaId,
      oportunidadId: opId,
      partidas: [
        { descripcion: "Molde de inyección", detalle: "Acero P20, incluye pruebas", cantidad: 2, precioUnitario: 168500 },
        { descripcion: "Capacitación", cantidad: 8, precioUnitario: 1250 }
      ]
    });
    expect(res.status).toBe(201);
    const det = await api().get(`/api/v1/cotizaciones/${res.body.id}`).set("Cookie", agenteCookie);
    expect(det.body.partidas.map((p: { detalle: string | null }) => p.detalle)).toEqual(["Acero P20, incluye pruebas", null]);
    expect(det.body).toEqual(expect.objectContaining({ empresa_nombre: `Moldes ${marca} SA`, oportunidad_titulo: expect.stringContaining(marca), etapa_nombre: expect.any(String) }));
  });

  describe("tablero del agente 2", () => {
    let enviadaId: number;
    let vencidaId: number;

    beforeAll(async () => {
      const opA = await oportunidad(empresa2Id, agente2Id);
      const opB = await oportunidad(empresa2Id, agente2Id);
      const opC = await oportunidad(empresa2Id, agente2Id);
      // Aceptada este mes (300) y aceptada hace 40 días (400).
      expect((await estado(await enviada(empresa2Id, opA, 300), "aceptada")).status).toBe(200);
      const vieja = await enviada(empresa2Id, opB, 400);
      expect((await estado(vieja, "aceptada")).status).toBe(200);
      await db.update(cotizaciones).set({ actualizadoEn: new Date(Date.now() - 40 * 86_400_000) }).where(eq(cotizaciones.id, vieja));
      // Enviada (200) que vence en 2 días y se mandó hace 5.
      enviadaId = await enviada(empresa2Id, opC, 200, { fechaEsperadaCierre: sumarDias(hoy, 2) });
      await db.update(cotizaciones).set({ fechaEnvio: sumarDias(hoy, -5) }).where(eq(cotizaciones.id, enviadaId));
      // Rechazada (500) y vencida a mano (600, su cierre pasó hace 3 días).
      expect((await estado(await enviada(empresa2Id, opC, 500), "rechazada", { motivoRechazo: "precio" })).status).toBe(200);
      vencidaId = await enviada(empresa2Id, opC, 600, { fechaEsperadaCierre: sumarDias(hoy, -3) });
      expect((await estado(vencidaId, "vencida")).status).toBe(200);
      // Borrador (100): versión 2 de una enviada, que queda obsoleta.
      const v1 = await enviada(empresa2Id, opC, 900);
      expect((await api().post(`/api/v1/cotizaciones/${v1}/version`).set("Cookie", adminCookie).send({ partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 100 }] })).status).toBe(201);
    });

    it("cuenta y suma por estado, lo aceptado este mes y la tasa de aceptación", async () => {
      const res = await api().get("/api/v1/cotizaciones/conteos").set("Cookie", agente2Cookie);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        borrador: { cantidad: 1, total: "100.00" },
        enviada: { cantidad: 1, total: "200.00" },
        aceptada: { cantidad: 2, total: "700.00" },
        rechazada: { cantidad: 1, total: "500.00" },
        vencida: { cantidad: 1, total: "600.00" },
        obsoleta: { cantidad: 1 },
        aceptadas_este_mes: { cantidad: 1, total: "300.00" },
        tasa_aceptacion: { aceptadas: 2, respondidas: 3, pct: 66.67 }
      });
      const admin = await api().get("/api/v1/cotizaciones/conteos").set("Cookie", adminCookie).query({ responsableId: agente2Id });
      expect(admin.body).toEqual(res.body);
    });

    it("un agente solo cuenta lo de sus oportunidades", async () => {
      const res = await api().get("/api/v1/cotizaciones/conteos").set("Cookie", agenteCookie).query({ responsableId: agente2Id });
      expect(res.body.aceptada.cantidad).toBe(0);
      expect(res.body.vencida.cantidad).toBe(0);
    });

    it("la lista dice hace cuántos días se envió y en cuántos vence", async () => {
      const res = await api().get("/api/v1/cotizaciones").set("Cookie", agente2Cookie).query({ limit: 100 });
      const porId = new Map(res.body.data.map((c: { id: number }) => [c.id, c]));
      expect(porId.get(enviadaId)).toEqual(expect.objectContaining({ dias_desde_envio: 5, dias_para_cierre: 2, responsable_nombre: "Agente de prueba", empresa_nombre: `Tablero ${marca} SA` }));
      expect(porId.get(vencidaId)).toEqual(expect.objectContaining({ dias_para_cierre: -3 }));
      const borrador = res.body.data.find((c: { estado: string }) => c.estado === "borrador");
      expect(borrador).toEqual(expect.objectContaining({ dias_desde_envio: null, dias_para_cierre: null }));
    });

    it("busca por empresa o por folio, filtra por responsable y ordena por total", async () => {
      const porEmpresa = await api().get("/api/v1/cotizaciones").set("Cookie", adminCookie).query({ q: `Tablero ${marca}`, limit: 100 });
      expect(porEmpresa.body.data).toHaveLength(6);
      const porFolio = await api().get("/api/v1/cotizaciones").set("Cookie", adminCookie).query({ q: String(enviadaId) });
      expect(porFolio.body.data.map((c: { id: number }) => c.id)).toContain(enviadaId);
      const porResponsable = await api().get("/api/v1/cotizaciones").set("Cookie", adminCookie).query({ responsableId: agente2Id, orden: "total", limit: 100 });
      expect(porResponsable.body.data.map((c: { total: string }) => c.total)).toEqual(["600.00", "500.00", "400.00", "300.00", "200.00", "100.00"]);
    });
  });

  describe("vencidas automáticas", () => {
    function correrTrabajo() {
      return api().post("/api/v1/automatizacion/jobs/limpiar-borradores").set("X-API-Key", API_KEY);
    }
    async function auditoriasVencer(id: number) {
      return db.select({ usuarioId: auditoria.usuarioId }).from(auditoria)
        .where(and(eq(auditoria.entidad, "cotizacion"), eq(auditoria.entidadId, id), eq(auditoria.accion, "vencer_automatico")));
    }
    async function estadoDe(id: number) {
      return (await db.select({ estado: cotizaciones.estado }).from(cotizaciones).where(eq(cotizaciones.id, id)))[0]!.estado;
    }

    it("el trabajo diario vence las enviadas con cierre pasado, una sola vez, y luego se pueden aceptar o versionar", async () => {
      const agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
      const opD = await oportunidad(empresaId, agenteId);
      const pasada = await enviada(empresaId, opD, 100, { fechaEsperadaCierre: sumarDias(hoy, -1) });
      const otraPasada = await enviada(empresaId, opD, 100, { fechaEsperadaCierre: sumarDias(hoy, -10) });
      const deHoy = await enviada(empresaId, opD, 100, { fechaEsperadaCierre: hoy });
      const futura = await enviada(empresaId, opD, 100, { fechaEsperadaCierre: sumarDias(hoy, 5) });
      const sinFecha = await enviada(empresaId, opD, 100);
      const borrador = await cotizacion(empresaId, opD, 100, { fechaEsperadaCierre: sumarDias(hoy, -1) });

      const res = await correrTrabajo();
      expect(res.status).toBe(200);
      expect(res.body.cotizaciones_vencidas).toBeGreaterThanOrEqual(2);
      expect(await estadoDe(pasada)).toBe("vencida");
      expect(await estadoDe(otraPasada)).toBe("vencida");
      for (const id of [deHoy, futura, sinFecha]) expect(await estadoDe(id)).toBe("enviada");
      expect(await estadoDe(borrador)).toBe("borrador");
      expect(await auditoriasVencer(pasada)).toEqual([{ usuarioId: null }]);

      expect((await correrTrabajo()).status).toBe(200);
      expect(await auditoriasVencer(pasada)).toHaveLength(1);

      // El cliente contesta tarde: una vencida NO queda bloqueada. Primero
      // se versiona (aceptar después gana la oportunidad y la cierra).
      const version = await api().post(`/api/v1/cotizaciones/${otraPasada}/version`).set("Cookie", adminCookie)
        .send({ fechaEsperadaCierre: sumarDias(hoy, 30), partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 100 }] });
      expect(version.status).toBe(201);
      expect(await estadoDe(otraPasada)).toBe("obsoleta");
      expect((await estado(pasada, "aceptada")).status).toBe(200);
    });

    it("una vencida también se puede marcar rechazada", async () => {
      const agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
      const id = await enviada(empresaId, await oportunidad(empresaId, agenteId), 100);
      expect((await estado(id, "vencida")).status).toBe(200);
      expect((await estado(id, "rechazada", { motivoRechazo: "tiempo_entrega" })).status).toBe(200);
    });
  });
});
