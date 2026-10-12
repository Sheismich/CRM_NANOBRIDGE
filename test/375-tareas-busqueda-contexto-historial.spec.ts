import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { campanas, envios, mediosContacto, prospectos, respuestas, tareas } from "../src/database/schema.js";
import { eq } from "drizzle-orm";

const API_KEY = "test_crm_callback_api_key_0001";

// Tareas nuevas (diseño "Mi día" + lista con detalle, 9-oct-2026): buscar
// por texto, ver de quién es la tarea y qué la originó, y su historial.
describe("tareas: búsqueda, contexto e historial", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let tareaId: number;
  let prospectoId: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const correoAgente = `tareas.ctx.${Date.now()}@test.local`;
    agenteCookie = await crearAgente(app, adminCookie, correoAgente);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;

    const reg = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Moldes ${marca} SA` },
      contacto: { nombre: "Ana Contexto", correo: `ctx.${randomUUID()}@prospeccion.test` }
    });
    prospectoId = reg.body.id;
    const [e] = await db.insert(envios).values({ prospectoId, canal: "correo", numeroContacto: 1, ventanaVenceEn: new Date(Date.now() + 86_400_000), ventanaEstado: "cerrada", executionId: randomUUID(), enviadoEn: new Date(Date.now() - 3 * 86_400_000) });
    const [r] = await db.insert(respuestas).values({ prospectoId, envioId: e.insertId, canal: "correo", contenido: "Sí nos interesa, márquenme el jueves", executionId: randomUUID(), estado: "clasificada", clasificacion: "interesado", recibidoEn: new Date(Date.now() - 86_400_000) });

    const crear = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Llamar a Ana ${marca}`, responsableId: agenteId, prospectoId });
    expect(crear.status).toBe(201);
    tareaId = crear.body.id;
    await db.update(tareas).set({ respuestaId: r.insertId }).where(eq(tareas.id, tareaId));
    await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Otra cosa ${randomUUID()}`, responsableId: agenteId });
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("busca por título o por nombre de la empresa", async () => {
    const porTitulo = await api().get("/api/v1/tareas").set("Cookie", adminCookie).query({ q: `Ana ${marca}` });
    expect(porTitulo.body.data.map((t: { id: number }) => t.id)).toEqual([tareaId]);
    const porEmpresa = await api().get("/api/v1/tareas").set("Cookie", agenteCookie).query({ q: `Moldes ${marca}` });
    expect(porEmpresa.body.data.map((t: { id: number }) => t.id)).toEqual([tareaId]);
    const comodin = await api().get("/api/v1/tareas").set("Cookie", adminCookie).query({ q: "%" });
    expect(comodin.status).toBe(200);
    expect(comodin.body.data.every((t: { titulo: string }) => t.titulo.includes("%"))).toBe(true);
  });

  it("el detalle trae la empresa, el contacto y la respuesta que la originó", async () => {
    const res = await api().get(`/api/v1/tareas/${tareaId}`).set("Cookie", agenteCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ empresa_nombre: `Moldes ${marca} SA`, contacto_nombre: "Ana Contexto", responsable_nombre: "Agente de prueba" }));
    expect(res.body.respuesta).toEqual(expect.objectContaining({ contenido: "Sí nos interesa, márquenme el jueves", clasificacion: "interesado" }));
  });

  // Mi día (ajuste del 11-oct): la caja "Lo que contestó" dice qué propuso
  // la IA y por qué; null si la IA no la vio.
  it("la respuesta del detalle trae lo que sugirió la IA y su porqué", async () => {
    const antes = await api().get(`/api/v1/tareas/${tareaId}`).set("Cookie", agenteCookie);
    expect(antes.body.respuesta).toEqual(expect.objectContaining({ clasificacion_sugerida: null, confianza_sugerida: null, motivo_sugerencia: null }));
    await db.update(respuestas).set({ clasificacionSugerida: "interesado", confianzaSugerida: 92, motivoSugerencia: "Pide que le marquen el jueves" }).where(eq(respuestas.id, antes.body.respuesta.id));
    const res = await api().get(`/api/v1/tareas/${tareaId}`).set("Cookie", agenteCookie);
    expect(res.body.respuesta).toEqual(expect.objectContaining({ clasificacion_sugerida: "interesado", confianza_sugerida: 92, motivo_sugerencia: "Pide que le marquen el jueves" }));
  });

  // Mi día (ajuste del 11-oct): chip de la campaña y el teléfono junto a los
  // botones. Un teléfono "no_contactar" no sale; si no hay principal, el
  // teléfono va antes que el WhatsApp.
  it("el detalle trae la campaña del prospecto y un teléfono activo del contacto", async () => {
    const [p] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospectoId));
    const [c] = await db.insert(campanas).values({ nombre: `Manufactura ${marca}`, estado: "activa" });
    await db.update(prospectos).set({ campanaId: c.insertId }).where(eq(prospectos.id, prospectoId));
    await db.insert(mediosContacto).values([
      { contactoId: p.contactoId, tipo: "telefono", valor: "477 111 1111", valorNormalizado: "4771111111", estadoContacto: "no_contactar" },
      { contactoId: p.contactoId, tipo: "whatsapp", valor: "477 222 2222", valorNormalizado: "4772222222" },
      { contactoId: p.contactoId, tipo: "telefono", valor: "477 333 3333", valorNormalizado: "4773333333" }
    ]);

    const res = await api().get(`/api/v1/tareas/${tareaId}`).set("Cookie", agenteCookie);
    expect(res.body.campana_nombre).toBe(`Manufactura ${marca}`);
    expect(res.body.contacto_telefono).toEqual({ tipo: "telefono", valor: "477 333 3333" });

    const sinProspecto = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Sin prospecto ${randomUUID()}`, responsableId: agenteId });
    const otra = await api().get(`/api/v1/tareas/${sinProspecto.body.id}`).set("Cookie", agenteCookie);
    expect(otra.body.campana_nombre).toBeNull();
    expect(otra.body.contacto_telefono).toBeNull();
  });

  it("el historial junta lo de la tarea y lo de la prospección, lo más nuevo primero", async () => {
    await api().patch(`/api/v1/tareas/${tareaId}/asignar`).set("Cookie", adminCookie).send({ responsableId: (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id });
    const res = await api().get(`/api/v1/tareas/${tareaId}/historial`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const tipos = res.body.map((e: { tipo: string }) => e.tipo);
    expect(tipos).toEqual(["asignada", "creada", "respuesta", "envio"]);
    expect(res.body[2]).toEqual(expect.objectContaining({ clasificacion: "interesado" }));
    expect(res.body[3]).toEqual(expect.objectContaining({ numero_contacto: 1 }));
  });

  it("un agente no ve el historial de una tarea que ya no es suya", async () => {
    const res = await api().get(`/api/v1/tareas/${tareaId}/historial`).set("Cookie", agenteCookie);
    expect(res.status).toBe(404);
  });
});
