import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, envios, eventosPendientes, procesosFallidos } from "../src/database/schema.js";
import { TIPO_ERROR_WORKFLOW } from "../src/automatizacion/automatizacion.service.js";
import { diaSiguiente, fechaMx, inicioDelDiaMxSql } from "../src/shared/dia-habil.js";

// Administración del rediseño (12-oct-2026; puntos 38/54 y 39):
// - "Problemas abiertos" agrupados por causa: los avisos de la API a n8n que
//   agotaron sus reintentos se agrupan por el mismo error y se pueden
//   reintentar todos; las fallas de un workflow de n8n (B4) se agrupan por
//   workflow + nodo y SOLO se marcan resueltas (condición de Fabián).
// - Estado del sistema: API, base de datos, avisos a n8n y correos.
describe("administración: estado del sistema y problemas agrupados", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  type Grupo = { clave: string; tipo: string; cantidad: number; mensaje: string; workflow?: string | null; nodo?: string | null; tipos_evento?: { tipo: string; cantidad: number }[]; acciones: string[] };

  // Un aviso que agotó sus reintentos: el evento queda fallido y deja su
  // proceso fallido (lo mismo que hace outbox-dispatcher.service.ts).
  async function avisoFallido(tipo: string, mensaje: string) {
    const [evento] = await db.insert(eventosPendientes).values({ eventoUuid: randomUUID(), tipo, entidadTipo: "tarea", entidadId: 1, payload: { marca }, estado: "fallido", intentos: 5, ultimoError: mensaje });
    const [proceso] = await db.insert(procesosFallidos).values({ eventoId: evento.insertId, tipo, payload: { marca }, mensaje });
    return { eventoId: evento.insertId, procesoId: proceso.insertId };
  }

  async function fallaWorkflow(workflow: string, nodo: string, mensaje: string, estado: "abierto" | "resuelto" = "abierto") {
    const [proceso] = await db.insert(procesosFallidos).values({ tipo: TIPO_ERROR_WORKFLOW, workflow, nodo, payload: { marca }, mensaje, estado });
    return proceso.insertId;
  }

  async function grupos(query: Record<string, unknown> = {}) {
    const res = await api().get("/api/v1/admin/problemas").set("Cookie", adminCookie).query(query);
    expect(res.status).toBe(200);
    return res.body.grupos as Grupo[];
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `admin.salud.${Date.now()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("problemas agrupados", () => {
    const sinUrl = `Falta N8N_WEBHOOK_URL ${marca}`;
    const timeout = `Timeout al llamar a n8n ${marca}`;
    const workflow = `PT1 · ingesta ${marca}`;
    let avisos: { eventoId: number; procesoId: number }[];
    let otroAviso: { eventoId: number; procesoId: number };
    let fallasB4: number[];

    beforeAll(async () => {
      avisos = [
        await avisoFallido("tarea_sla_vencida", sinUrl),
        await avisoFallido("prospecto_clasificado", sinUrl),
        await avisoFallido("prospecto_clasificado", sinUrl)
      ];
      otroAviso = await avisoFallido("tarea_cerrada", timeout);
      fallasB4 = [
        await fallaWorkflow(workflow, "Enviar correo (subflujo)", "El subflujo no estaba publicado"),
        await fallaWorkflow(workflow, "Enviar correo (subflujo)", "Otra vez sin publicar")
      ];
      // Una ya resuelta no aparece entre los abiertos.
      await fallaWorkflow(workflow, "Enviar correo (subflujo)", "Vieja", "resuelto");
    });

    it("los avisos se agrupan por el mismo error y las fallas de n8n por workflow + nodo", async () => {
      const todos = await grupos();
      const deSinUrl = todos.find((g) => g.mensaje === sinUrl);
      expect(deSinUrl).toMatchObject({ tipo: "aviso_api", cantidad: 3, acciones: ["reintentar", "resolver"] });
      expect(deSinUrl!.tipos_evento).toEqual([{ tipo: "prospecto_clasificado", cantidad: 2 }, { tipo: "tarea_sla_vencida", cantidad: 1 }]);
      expect(todos.find((g) => g.mensaje === timeout)).toMatchObject({ tipo: "aviso_api", cantidad: 1 });

      const deN8n = todos.filter((g) => g.workflow === workflow);
      expect(deN8n).toHaveLength(1);
      expect(deN8n[0]).toMatchObject({ tipo: "workflow_n8n", nodo: "Enviar correo (subflujo)", cantidad: 2, mensaje: "Otra vez sin publicar", acciones: ["resolver"] });
    });

    it("una falla de un workflow de n8n no se reintenta (409), solo se marca resuelta", async () => {
      const grupo = (await grupos()).find((g) => g.workflow === workflow)!;
      const res = await api().post("/api/v1/admin/problemas/reintentar").set("Cookie", adminCookie).send({ clave: grupo.clave });
      expect(res.status).toBe(409);

      const resolver = await api().post("/api/v1/admin/problemas/resolver").set("Cookie", adminCookie).send({ clave: grupo.clave });
      expect(resolver.status).toBe(200);
      expect(resolver.body).toEqual({ resueltos: 2 });
      const filas = await db.select({ estado: procesosFallidos.estado }).from(procesosFallidos).where(inArray(procesosFallidos.id, fallasB4));
      expect(filas.every((f) => f.estado === "resuelto")).toBe(true);
      expect((await grupos()).find((g) => g.workflow === workflow)).toBeUndefined();
      // Cada fila deja su auditoría, como el botón de una sola.
      const auditadas = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "proceso_fallido"), inArray(auditoria.entidadId, fallasB4)));
      expect(auditadas).toHaveLength(2);
    });

    it("reintentar todos: los avisos vuelven a la cola, sus problemas se cierran y cada uno queda auditado", async () => {
      const grupo = (await grupos()).find((g) => g.mensaje === sinUrl)!;
      const res = await api().post("/api/v1/admin/problemas/reintentar").set("Cookie", adminCookie).send({ clave: grupo.clave });
      expect(res.status).toBe(200);
      // En las pruebas no hay N8N_WEBHOOK_URL: quedan esperando, y se avisa.
      expect(res.body).toEqual({ reintentados: 3, resueltos: 3, sin_destino: true });

      const eventos = await db.select({ estado: eventosPendientes.estado, intentos: eventosPendientes.intentos }).from(eventosPendientes).where(inArray(eventosPendientes.id, avisos.map((a) => a.eventoId)));
      expect(eventos.every((e) => e.estado === "pendiente" && e.intentos === 0)).toBe(true);
      const procesos = await db.select({ estado: procesosFallidos.estado }).from(procesosFallidos).where(inArray(procesosFallidos.id, avisos.map((a) => a.procesoId)));
      expect(procesos.every((p) => p.estado === "resuelto")).toBe(true);
      const auditados = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "evento_pendiente"), eq(auditoria.accion, "reintentar"), inArray(auditoria.entidadId, avisos.map((a) => a.eventoId))));
      expect(auditados).toHaveLength(3);

      // El otro grupo no se tocó.
      const [otro] = await db.select({ estado: eventosPendientes.estado }).from(eventosPendientes).where(eq(eventosPendientes.id, otroAviso.eventoId));
      expect(otro?.estado).toBe("fallido");
      expect((await grupos()).find((g) => g.mensaje === sinUrl)).toBeUndefined();
    });

    it("una clave que ya no existe da 404 y la pantalla es solo del administrador", async () => {
      expect((await api().post("/api/v1/admin/problemas/resolver").set("Cookie", adminCookie).send({ clave: "aviso:no-existe" })).status).toBe(404);
      expect((await api().get("/api/v1/admin/problemas").set("Cookie", agenteCookie)).status).toBe(403);
    });
  });

  describe("estado del sistema", () => {
    it("dice cómo está cada servicio y cuánto falta configurar", async () => {
      const res = await api().get("/api/v1/admin/salud").set("Cookie", adminCookie);
      expect(res.status).toBe(200);

      expect(res.body.api).toEqual({ estado: "ok", revision: null });
      expect(res.body.base_datos.estado).toBe("ok");
      expect(typeof res.body.base_datos.responde_ms).toBe("number");

      const [espera] = await db.select({ n: sql<number>`COUNT(*)` }).from(eventosPendientes).where(eq(eventosPendientes.estado, "pendiente"));
      const [fallidos] = await db.select({ n: sql<number>`COUNT(*)` }).from(eventosPendientes).where(eq(eventosPendientes.estado, "fallido"));
      // En las pruebas no hay N8N_WEBHOOK_URL.
      expect(res.body.avisos_n8n).toEqual({ estado: "atencion", configurado: false, en_espera: Number(espera!.n), fallidos: Number(fallidos!.n) });

      const hoy = fechaMx(new Date());
      const [correos] = await db.select({ n: sql<number>`COUNT(*)`, ultimo: sql<string | null>`MAX(${envios.enviadoEn})` }).from(envios)
        .where(and(sql`${envios.enviadoEn} >= ${inicioDelDiaMxSql(hoy)}`, sql`${envios.enviadoEn} < ${inicioDelDiaMxSql(diaSiguiente(hoy))}`));
      expect(res.body.correos.enviados_hoy).toBe(Number(correos!.n));

      expect(res.body.por_configurar).toEqual([{ clave: "N8N_WEBHOOK_URL", texto: "Falta la dirección de n8n (N8N_WEBHOOK_URL): los avisos esperan sin salir." }]);
      const abiertos = await grupos();
      expect(res.body.resumen).toEqual({ por_configurar: 1, problemas_abiertos: abiertos.length });
      expect(typeof res.body.revisado_en).toBe("string");
    });

    it("solo el administrador la ve", async () => {
      expect((await api().get("/api/v1/admin/salud").set("Cookie", agenteCookie)).status).toBe(403);
    });
  });
});
