import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, envios, prospectos, respuestas, tareas } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// POST /automatizacion/respuestas con los dos modos que usa PT2 (ronda 3 de
// SendGrid, PLAN_N8N_DEFINITIVO.md, 29-sep-2026): mientras no haya
// clasificación con IA, cada respuesta real deja una sola tarea de
// clasificación para la cola, y las respuestas automáticas (fuera de
// oficina) se guardan sin cerrar la ventana ni crear tarea.
describe("respuestas recibidas: tarea de clasificación y respuestas automáticas", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function registrarProspecto() {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Recibidas ${randomUUID()}` }, contacto: { nombre: "Persona Recibida", correo: `recibida.${randomUUID()}@respuestas.test` } });
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

  function registrarRespuesta(prospectoId: number, extra: Record<string, unknown>, executionId: string = randomUUID()) {
    return api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: executionId, prospecto_id: prospectoId, canal: "correo", contenido: "Me interesa, llámenme", ...extra });
  }

  async function ventana(envioId: number) {
    const [fila] = await db.select({ ventanaEstado: envios.ventanaEstado }).from(envios).where(eq(envios.id, envioId));
    return fila!.ventanaEstado;
  }

  function tareasDe(prospectoId: number) {
    return db.select().from(tareas).where(eq(tareas.prospectoId, prospectoId));
  }

  async function estadoProspecto(prospectoId: number) {
    const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId));
    return fila!.estado;
  }

  describe("crear_tarea_clasificacion", () => {
    it("a tiempo: cierra la ventana y crea una sola tarea de clasificación ligada a la respuesta, sin tocar el estado del prospecto", async () => {
      const prospectoId = await registrarProspecto();
      const envioId = await registrarEnvio(prospectoId);
      const estadoAntes = await estadoProspecto(prospectoId);

      const res = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true });
      expect(res.status).toBe(201);
      expect(res.body.tardia).toBe(false);
      expect(res.body.tarea_id).toEqual(expect.any(Number));

      expect(await ventana(envioId)).toBe("cerrada");
      const lista = await tareasDe(prospectoId);
      expect(lista).toHaveLength(1);
      expect(lista[0]!.id).toBe(res.body.tarea_id);
      expect(lista[0]!.tipo).toBe("clasificacion");
      expect(lista[0]!.estado).toBe("pendiente");
      expect(lista[0]!.respuestaId).toBe(res.body.id);
      expect(lista[0]!.descripcion).toBe("Me interesa, llámenme");

      const [respuesta] = await db.select({ estado: respuestas.estado, clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, res.body.id));
      expect(respuesta).toEqual({ estado: "pendiente_clasificacion", clasificacion: null });
      expect(await estadoProspecto(prospectoId)).toBe(estadoAntes);
    });

    it("tardía: la tarea de clasificación sustituye a la de 'Respuesta tardía', no quedan dos", async () => {
      const prospectoId = await registrarProspecto();

      const res = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true });
      expect(res.status).toBe(201);
      expect(res.body.tardia).toBe(true);

      const lista = await tareasDe(prospectoId);
      expect(lista).toHaveLength(1);
      expect(lista[0]!.tipo).toBe("clasificacion");
      expect(lista[0]!.respuestaId).toBe(res.body.id);
    });

    it("un reintento con el mismo execution_id no crea otra tarea", async () => {
      const prospectoId = await registrarProspecto();
      await registrarEnvio(prospectoId);
      const executionId = randomUUID();

      const primero = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true }, executionId);
      const segundo = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true }, executionId);
      expect(segundo.status).toBe(200);
      expect(segundo.body.ya_existia).toBe(true);
      expect(segundo.body.id).toBe(primero.body.id);
      expect(await tareasDe(prospectoId)).toHaveLength(1);
    });

    it("un execution_id de 100 caracteres no rompe la tarea (su execution_id no crece con el de la respuesta)", async () => {
      const prospectoId = await registrarProspecto();
      const res = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true }, `msg-${randomUUID()}`.padEnd(100, "x"));
      expect(res.status).toBe(201);
      expect(await tareasDe(prospectoId)).toHaveLength(1);
    });

    it("la tarea se resuelve desde la cola: la respuesta queda clasificada y el prospecto cambia de estado", async () => {
      const prospectoId = await registrarProspecto();
      await registrarEnvio(prospectoId);
      const res = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true });

      const clasificada = await api().post(`/api/v1/cola-clasificacion/${res.body.tarea_id}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "interesado" });
      expect(clasificada.status).toBe(200);

      const [respuesta] = await db.select({ estado: respuestas.estado, clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, res.body.id));
      expect(respuesta).toEqual({ estado: "clasificada", clasificacion: "interesado" });
      expect(await estadoProspecto(prospectoId)).toBe("interesado");
    });
  });

  describe("automatica", () => {
    it("se guarda como clasificada 'automatica', sin cerrar la ventana, sin tarea y sin tocar el estado del prospecto", async () => {
      const prospectoId = await registrarProspecto();
      const envioId = await registrarEnvio(prospectoId);
      const estadoAntes = await estadoProspecto(prospectoId);

      const res = await registrarRespuesta(prospectoId, { automatica: true, contenido: "Estoy fuera de la oficina hasta el lunes" });
      expect(res.status).toBe(201);
      expect(res.body.tarea_id).toBeNull();

      expect(await ventana(envioId)).toBe("abierta");
      expect(await tareasDe(prospectoId)).toHaveLength(0);
      const [respuesta] = await db.select({ estado: respuestas.estado, clasificacion: respuestas.clasificacion, envioId: respuestas.envioId, clasificadoEn: respuestas.clasificadoEn }).from(respuestas).where(eq(respuestas.id, res.body.id));
      expect(respuesta!.estado).toBe("clasificada");
      expect(respuesta!.clasificacion).toBe("automatica");
      expect(respuesta!.envioId).toBe(envioId);
      expect(respuesta!.clasificadoEn).not.toBeNull();
      expect(await estadoProspecto(prospectoId)).toBe(estadoAntes);
    });

    it("tardía tampoco crea tarea", async () => {
      const prospectoId = await registrarProspecto();
      const res = await registrarRespuesta(prospectoId, { automatica: true });
      expect(res.status).toBe(201);
      expect(res.body.tardia).toBe(true);
      expect(await tareasDe(prospectoId)).toHaveLength(0);
    });

    it("el historial de la ficha la muestra con resultado 'automatica'", async () => {
      const prospectoId = await registrarProspecto();
      const [fila] = await db.select({ contactoId: prospectos.contactoId, empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, prospectoId));
      const res = await registrarRespuesta(prospectoId, { automatica: true });

      const timeline = await api().get("/api/v1/actividades").set("Cookie", adminCookie).query({ empresaId: fila!.empresaId, contactoId: fila!.contactoId });
      expect(timeline.status).toBe(200);
      const evento = timeline.body.data.find((e: { tipo: string; detalle: { respuesta_id?: number } }) => e.tipo === "correo_recibido" && e.detalle.respuesta_id === res.body.id);
      expect(evento?.resultado).toBe("automatica");
    });
  });

  it("no se aceptan las dos marcas a la vez", async () => {
    const prospectoId = await registrarProspecto();
    const res = await registrarRespuesta(prospectoId, { crear_tarea_clasificacion: true, automatica: true });
    expect(res.status).toBe(400);
  });

  it("sin marcas sigue igual: una respuesta tardía crea la tarea de seguimiento 'Respuesta tardía'", async () => {
    const prospectoId = await registrarProspecto();
    const res = await registrarRespuesta(prospectoId, {});
    expect(res.status).toBe(201);
    const lista = await db.select().from(tareas).where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.tipo, "seguimiento")));
    expect(lista).toHaveLength(1);
    expect(lista[0]!.titulo).toBe("Respuesta tardía de prospecto");
  });
});
