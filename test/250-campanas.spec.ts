import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

type Campana = {
  id: number;
  nombre: string;
  canal: string;
  estado: string;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  prospectos: number;
  activa_hoy: boolean;
  motivo: string | null;
};

// Campañas (1-oct-2026): la tabla existía desde 003 pero no había forma de
// crearlas, y sin campaña PT1/PT4 solo funcionan en modo pruebas.
// Administradores y supervisores las crean y cambian; los agentes solo ven.
describe("campañas", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let supervisorCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `campanas.agente.${randomUUID()}@test.local`);
    const correoSupervisor = `campanas.supervisor.${randomUUID()}@test.local`;
    const sup = await request(app.getHttpServer()).post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: "Supervisor Campañas", correo: correoSupervisor, password: "password_supervisor_1", rol: "supervisor" });
    expect(sup.status).toBe(201);
    supervisorCookie = await loginAs(app, correoSupervisor, "password_supervisor_1");
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  function diasDesdeHoy(dias: number) {
    return fechaMx(new Date(Date.now() + dias * 86_400_000));
  }

  async function crear(body: Record<string, unknown> = {}, cookie = adminCookie) {
    return api().post("/api/v1/campanas").set("Cookie", cookie).send({ nombre: `Campaña ${randomUUID()}`, ...body });
  }

  async function crearId(body: Record<string, unknown> = {}) {
    const res = await crear(body);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function accion(id: number, nombre: "activar" | "pausar" | "finalizar", cookie = adminCookie) {
    return api().post(`/api/v1/campanas/${id}/${nombre}`).set("Cookie", cookie);
  }

  describe("crear", () => {
    it("nace en borrador, canal correo, y no manda todavía", async () => {
      const res = await crear({ fechaInicio: diasDesdeHoy(0), fechaFin: diasDesdeHoy(30) });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ estado: "borrador", canal: "correo", fecha_inicio: diasDesdeHoy(0), fecha_fin: diasDesdeHoy(30), prospectos: 0, activa_hoy: false, motivo: "borrador" });
    });

    it("WhatsApp sigue apagado: 400", async () => {
      expect((await crear({ canal: "whatsapp" })).status).toBe(400);
    });

    it("fecha de inicio después de la de fin: 400", async () => {
      expect((await crear({ fechaInicio: diasDesdeHoy(10), fechaFin: diasDesdeHoy(1) })).status).toBe(400);
    });

    it("un supervisor también puede; un agente no (403)", async () => {
      expect((await crear({}, supervisorCookie)).status).toBe(201);
      expect((await crear({}, agenteCookie)).status).toBe(403);
    });

    it("queda en la auditoría", async () => {
      const id = await crearId();
      const [fila] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "campana"), eq(auditoria.entidadId, id), eq(auditoria.accion, "crear")));
      expect(fila).toBeDefined();
    });
  });

  describe("ver y listar", () => {
    it("la lista trae cuántos prospectos tiene cada campaña y si manda hoy; un agente también la ve", async () => {
      const id = await crearId();
      expect((await accion(id, "activar")).status).toBe(200);
      for (let i = 0; i < 2; i++) {
        const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Campaña ${randomUUID()}` }, contacto: { nombre: "Persona Campaña", correo: `campana.${randomUUID()}@campanas.test` }, campana_id: id });
        expect(res.status).toBe(201);
      }

      const lista = await api().get("/api/v1/campanas").set("Cookie", agenteCookie).query({ estado: "activa", limit: 100 });
      expect(lista.status).toBe(200);
      const fila = (lista.body.data as Campana[]).find((c) => c.id === id);
      expect(fila).toMatchObject({ estado: "activa", prospectos: 2, activa_hoy: true, motivo: null });
      expect((lista.body.data as Campana[]).every((c) => c.estado === "activa")).toBe(true);
    });

    it("una campaña: 200; una que no existe: 404", async () => {
      const id = await crearId();
      expect((await api().get(`/api/v1/campanas/${id}`).set("Cookie", agenteCookie)).body).toMatchObject({ id, estado: "borrador" });
      expect((await api().get("/api/v1/campanas/999999999").set("Cookie", adminCookie)).status).toBe(404);
    });
  });

  describe("editar", () => {
    it("cambia nombre y fechas; vaciar una fecha la quita", async () => {
      const id = await crearId({ fechaFin: diasDesdeHoy(30) });
      const res = await api().patch(`/api/v1/campanas/${id}`).set("Cookie", adminCookie).send({ nombre: "Campaña renombrada", fechaInicio: diasDesdeHoy(2), fechaFin: null });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ nombre: "Campaña renombrada", fecha_inicio: diasDesdeHoy(2), fecha_fin: null });
    });

    it("las fechas se validan contra lo que ya tiene guardado: 400", async () => {
      const id = await crearId({ fechaFin: diasDesdeHoy(5) });
      expect((await api().patch(`/api/v1/campanas/${id}`).set("Cookie", adminCookie).send({ fechaInicio: diasDesdeHoy(10) })).status).toBe(400);
    });

    // B7 del plan de fixes (2-oct-2026): poner una fecha de fin pasada a
    // una campaña que manda la dejaba vencida en silencio, y PT4 cancelaba
    // todos sus recordatorios. Para terminarla está "finalizar".
    it.each(["activa", "pausada"] as const)("a una campaña %s no se le pone una fecha de fin pasada: 409 y no cambia nada", async (estado) => {
      const id = await crearId({ fechaInicio: diasDesdeHoy(-10), fechaFin: diasDesdeHoy(30) });
      expect((await accion(id, "activar")).status).toBe(200);
      if (estado === "pausada") expect((await accion(id, "pausar")).status).toBe(200);

      const res = await api().patch(`/api/v1/campanas/${id}`).set("Cookie", adminCookie).send({ nombre: "Ya no debería cambiar", fechaFin: diasDesdeHoy(-1) });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CAMPANA_VENCIDA");
      const guardada = (await api().get(`/api/v1/campanas/${id}`).set("Cookie", adminCookie)).body;
      expect(guardada).toMatchObject({ estado, fecha_fin: diasDesdeHoy(30) });
      expect(guardada.nombre).not.toBe("Ya no debería cambiar");
    });

    it("fecha de fin hoy sí se puede (todavía manda hoy); en borrador también una pasada", async () => {
      const activa = await crearId({ fechaInicio: diasDesdeHoy(-10) });
      expect((await accion(activa, "activar")).status).toBe(200);
      const hoy = await api().patch(`/api/v1/campanas/${activa}`).set("Cookie", adminCookie).send({ fechaFin: diasDesdeHoy(0) });
      expect(hoy.status).toBe(200);
      expect(hoy.body).toMatchObject({ fecha_fin: diasDesdeHoy(0), activa_hoy: true });

      const borrador = await crearId({ fechaInicio: diasDesdeHoy(-10) });
      expect((await api().patch(`/api/v1/campanas/${borrador}`).set("Cookie", adminCookie).send({ fechaFin: diasDesdeHoy(-1) })).status).toBe(200);
    });

    // Antes se leía la campaña fuera de la transacción: dos ediciones al
    // mismo tiempo validaban cada una contra la versión vieja y podían
    // dejar inicio después de fin.
    it("dos ediciones al mismo tiempo no dejan un rango de fechas imposible", async () => {
      const ids = await Promise.all(Array.from({ length: 5 }, () => crearId()));
      await Promise.all(ids.map((id) => Promise.all([
        api().patch(`/api/v1/campanas/${id}`).set("Cookie", adminCookie).send({ fechaInicio: diasDesdeHoy(20) }),
        api().patch(`/api/v1/campanas/${id}`).set("Cookie", adminCookie).send({ fechaFin: diasDesdeHoy(10) })
      ])));
      for (const id of ids) {
        const { body } = await api().get(`/api/v1/campanas/${id}`).set("Cookie", adminCookie);
        if (body.fecha_inicio && body.fecha_fin) expect(body.fecha_inicio <= body.fecha_fin).toBe(true);
      }
    });

    it("una finalizada ya no se edita: 409; un agente no edita: 403", async () => {
      const id = await crearId();
      expect((await api().patch(`/api/v1/campanas/${id}`).set("Cookie", agenteCookie).send({ nombre: "x123" })).status).toBe(403);
      expect((await accion(id, "finalizar")).status).toBe(200);
      const res = await api().patch(`/api/v1/campanas/${id}`).set("Cookie", adminCookie).send({ nombre: "Otro nombre" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CAMPANA_FINALIZADA");
    });
  });

  describe("activar, pausar, finalizar", () => {
    it("borrador → activa → pausada → activa → finalizada, cada paso auditado", async () => {
      const id = await crearId();
      expect((await accion(id, "activar")).body).toMatchObject({ estado: "activa", activa_hoy: true });
      expect((await accion(id, "pausar")).body).toMatchObject({ estado: "pausada", activa_hoy: false, motivo: "pausada" });
      expect((await accion(id, "activar")).body).toMatchObject({ estado: "activa" });
      expect((await accion(id, "finalizar")).body).toMatchObject({ estado: "finalizada", motivo: "finalizada" });

      const pasos = await db.select({ accion: auditoria.accion }).from(auditoria).where(and(eq(auditoria.entidad, "campana"), eq(auditoria.entidadId, id))).orderBy(auditoria.id);
      expect(pasos.map((p) => p.accion)).toEqual(["crear", "activar", "pausar", "activar", "finalizar"]);
    });

    it.each([
      ["borrador", "pausar"],
      ["finalizada", "activar"],
      ["finalizada", "pausar"],
      ["finalizada", "finalizar"]
    ] as const)("desde %s no se puede %s: 409 con code", async (desde, intento) => {
      const id = await crearId();
      if (desde === "finalizada") expect((await accion(id, "finalizar")).status).toBe(200);
      const res = await accion(id, intento);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TRANSICION_CAMPANA_INVALIDA");
    });

    it("activar una campaña cuya fecha de fin ya pasó: 409", async () => {
      const id = await crearId({ fechaInicio: diasDesdeHoy(-20), fechaFin: diasDesdeHoy(-1) });
      const res = await accion(id, "activar");
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("CAMPANA_VENCIDA");
    });

    it("activa con fecha de inicio futura: queda activa pero en espera", async () => {
      const id = await crearId({ fechaInicio: diasDesdeHoy(7) });
      expect((await accion(id, "activar")).body).toMatchObject({ estado: "activa", activa_hoy: false, motivo: "aun_no_empieza" });
    });

    it("dos activaciones al mismo tiempo: una pasa, la otra 409, y una sola fila de auditoría", async () => {
      const id = await crearId();
      const [a, b] = await Promise.all([accion(id, "activar"), accion(id, "activar")]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const activaciones = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "campana"), eq(auditoria.entidadId, id), eq(auditoria.accion, "activar")));
      expect(activaciones).toHaveLength(1);
    });

    it("un agente no puede cambiar el estado: 403", async () => {
      const id = await crearId();
      expect((await accion(id, "activar", agenteCookie)).status).toBe(403);
    });

    it("lo que dice la API a PT1 coincide con la campaña", async () => {
      const id = await crearId();
      const consultar = () => api().get("/api/v1/automatizacion/campanas/activa").set("X-API-Key", API_KEY).query({ campana_id: id });
      await accion(id, "activar");
      expect((await consultar()).body).toMatchObject({ activa: true });
      await accion(id, "pausar");
      expect((await consultar()).body).toMatchObject({ activa: false, motivo: "pausada" });
    });
  });
});
