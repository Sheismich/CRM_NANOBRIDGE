import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, campanas, contactos, documentos, envios, eventosPendientes, procesosFallidos, prospectos, respuestas, tareas } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Reportes · Día = bitácora (Fabián lo aprobó el 11-oct-2026; punto 52):
// todo lo que pasó en el CRM un día, en orden de hora, con los números del
// día, lo que hizo cada persona y lo que quedó pendiente. Se arma un día fijo
// del pasado (11-mar-2025, hora de México = UTC-6) para que lo que crean las
// demás pruebas "hoy" no se cuele.
describe("reportes: el día (bitácora)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteACookie: string[];
  let agenteBCookie: string[];
  let adminId: number;
  let agenteA: number;
  let agenteB: number;
  let t3: number;
  const FECHA = "2025-03-11";
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const a = (hhmm: string) => new Date(`${FECHA}T${hhmm}:00-06:00`);
  const marca = randomUUID().slice(0, 8);

  async function prospecto(nombre: string) {
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Empresa ${nombre} ${marca}` },
      contacto: { nombre, correo: `dia.${randomUUID()}@prospeccion.test` }
    });
    expect(res.status).toBeLessThan(300);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
    agenteACookie = await crearAgente(app, adminCookie, `dia.a.${Date.now()}@test.local`);
    agenteBCookie = await crearAgente(app, adminCookie, `dia.b.${Date.now()}@test.local`);
    agenteA = (await api().get("/api/v1/auth/me").set("Cookie", agenteACookie)).body.id;
    agenteB = (await api().get("/api/v1/auth/me").set("Cookie", agenteBCookie)).body.id;

    // Prospección: 3 correos de una campaña (2 iniciales a las 9, 1
    // recordatorio a las 11), una respuesta interesada y una baja.
    const [c] = await db.insert(campanas).values({ nombre: `Manufactura ${marca}`, estado: "activa" });
    const p1 = await prospecto("Ana Ruiz");
    const p2 = await prospecto("Luis Ortega");
    const p3 = await prospecto("Eva Mora");
    for (const p of [p1, p2, p3]) await db.update(prospectos).set({ campanaId: c.insertId }).where(eq(prospectos.id, p));
    const ventana = new Date(`${FECHA}T23:00:00Z`);
    const [e1] = await db.insert(envios).values({ prospectoId: p1, numeroContacto: 1, ventanaVenceEn: ventana, executionId: randomUUID(), enviadoEn: a("09:05") });
    await db.insert(envios).values({ prospectoId: p2, numeroContacto: 1, ventanaVenceEn: ventana, executionId: randomUUID(), enviadoEn: a("09:10") });
    await db.insert(envios).values({ prospectoId: p3, numeroContacto: 2, ventanaVenceEn: ventana, executionId: randomUUID(), enviadoEn: a("11:00") });
    await db.insert(respuestas).values({ prospectoId: p1, envioId: e1.insertId, contenido: "Sí nos interesa", executionId: randomUUID(), estado: "clasificada", clasificacion: "interesado", recibidoEn: a("10:42") });
    await db.insert(auditoria).values({ usuarioId: null, entidad: "prospecto", entidadId: p2, accion: "cambiar_estado_automatizacion", despues: { estado: "baja", motivo: "link" }, creadoEn: a("11:03") });

    // Tareas: T1 la creó el admin y la cerró A a tiempo; T2 la creó la
    // automatización y B la tomó; T3 era de A, vencía a las 12:09 y no se cerró.
    const [t1] = await db.insert(tareas).values({ titulo: `Llamar a Ana ${marca}`, responsableId: agenteA, creadaPor: adminId, creadoEn: a("08:30"), fechaLimite: a("19:00"), estado: "cerrada", resultado: "Agendó demo", cerradaEn: a("18:10") });
    await db.insert(auditoria).values({ usuarioId: agenteA, entidad: "tarea", entidadId: t1.insertId, accion: "cerrar", despues: { resultado: "Agendó demo" }, creadoEn: a("18:10") });
    const [t2] = await db.insert(tareas).values({ titulo: `Revisión manual ${marca}`, responsableId: agenteB, creadaPor: null, creadoEn: a("10:42") });
    await db.insert(auditoria).values({ usuarioId: agenteB, entidad: "tarea", entidadId: t2.insertId, accion: "asignar", antes: { responsable_id: null }, despues: { responsable_id: agenteB }, creadoEn: a("16:20") });
    const [r3] = await db.insert(tareas).values({ titulo: `NO SE ${marca}`, responsableId: agenteA, creadaPor: adminId, creadoEn: a("08:00"), fechaLimite: a("12:09") });
    t3 = r3.insertId;

    // Documento que A subió a las 12:30.
    const [d] = await db.insert(documentos).values({ empresaId: (await db.select({ empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, p1)))[0]!.empresaId, version: 1, nombreOriginal: "INE representante.jpg", mimeType: "image/jpeg", tamanoBytes: 10, storageDriver: "local", storageKey: `x/${randomUUID()}`, subidoPor: agenteA });
    await db.insert(auditoria).values({ usuarioId: agenteA, entidad: "documento", entidadId: d.insertId, accion: "subir", despues: { nombre_original: "INE representante.jpg" }, creadoEn: a("12:30") });

    // Sistema: un aviso a n8n que falló a las 14:02 y otro que llegó al
    // tercer intento a las 14:10.
    await db.insert(procesosFallidos).values({ tipo: "outbox", payload: {}, mensaje: "n8n no respondió a tiempo", creadoEn: a("14:02") });
    await db.insert(eventosPendientes).values({ eventoUuid: randomUUID(), tipo: "tarea_cerrada", entidadTipo: "tarea", entidadId: t1.insertId, payload: {}, estado: "enviado", intentos: 3, creadoEn: a("14:00"), actualizadoEn: a("14:10") });
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  function dia(cookie: string[], query: Record<string, unknown> = {}) {
    return api().get("/api/v1/reportes/dia").set("Cookie", cookie).query({ fecha: FECHA, ...query });
  }

  it("da los números del día y lo que hay que revisar", async () => {
    const res = await dia(adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.fecha).toBe(FECHA);
    expect(res.body.resumen).toEqual({
      correos: { enviados: 3, campanas: 1, ultimo_en: a("11:00").toISOString() },
      respuestas: { recibidas: 1, interesados: 1 },
      tareas_cerradas: { cerradas: 1, vencian_ese_dia: 2 },
      tareas_creadas: { creadas: 3, por_automatizacion: 1 },
      bajas: { total: 1, ultima: { contacto_nombre: "Luis Ortega", fecha: a("11:03").toISOString() } }
    });
    expect(res.body.para_revisar).toEqual({ vencidas_sin_cerrar: 1, avisos_fallidos: 1 });
  });

  it("la bitácora trae todo en orden de hora, lo más tarde primero", async () => {
    const res = await dia(adminCookie, { limit: 100 });
    const { total, data } = res.body.bitacora;
    expect(total).toBe(13);
    expect(data.map((e: { tipo: string; subtipo: string }) => `${e.tipo}:${e.subtipo}`)).toEqual([
      "tareas:cerrada", // 18:10
      "tareas:tomada", // 16:20
      "sistema:reintento_ok", // 14:10
      "sistema:fallo", // 14:02
      "documentos:subido", // 12:30
      "tareas:vencida", // 12:09
      "bajas:baja", // 11:03
      "correos:lote", // 11:00
      "respuestas:respuesta", // 10:42
      "tareas:creada", // 10:42 (automatización)
      "correos:lote", // 09:10
      "tareas:creada", // 08:30
      "tareas:creada" // 08:00
    ]);
    expect(data[0]).toEqual(expect.objectContaining({ usuario_id: agenteA, entidad: { tipo: "tarea", id: expect.any(Number) }, texto: expect.stringContaining("Agendó demo") }));
    expect(data[1]).toEqual(expect.objectContaining({ usuario_id: agenteB, texto: expect.stringContaining("estaba sin asignar") }));
    const lotes = data.filter((e: { tipo: string }) => e.tipo === "correos");
    expect(lotes.map((e: { cantidad: number; numero_contacto: number }) => [e.cantidad, e.numero_contacto])).toEqual([[1, 2], [2, 1]]);
    expect(lotes[1].campana_nombre).toBe(`Manufactura ${marca}`);
    expect(data.find((e: { subtipo: string; usuario_id: number | null }) => e.subtipo === "creada" && e.usuario_id === null)).toBeTruthy();
  });

  it("filtra por tipo y pagina", async () => {
    const tareasDelDia = await dia(adminCookie, { tipo: "tareas" });
    expect(tareasDelDia.body.bitacora.total).toBe(6);
    const sistema = await dia(adminCookie, { tipo: "sistema" });
    expect(sistema.body.bitacora.data.map((e: { subtipo: string }) => e.subtipo)).toEqual(["reintento_ok", "fallo"]);
    const pagina3 = await dia(adminCookie, { limit: 5, page: 3 });
    expect(pagina3.body.bitacora).toEqual(expect.objectContaining({ total: 13, page: 3, limit: 5 }));
    expect(pagina3.body.bitacora.data).toHaveLength(3);
  });

  it("por persona: primera y última acción, cerradas, tomadas y vencidas, más la automatización", async () => {
    const res = await dia(adminCookie);
    const de = (id: number) => res.body.por_persona.find((p: { usuario_id: number }) => p.usuario_id === id);
    expect(de(agenteA)).toEqual(expect.objectContaining({ nombre: "Agente de prueba", primera_accion: a("12:30").toISOString(), ultima_accion: a("18:10").toISOString(), tareas_que_cerro: 1, tomadas: 0, vencidas: 1 }));
    expect(de(agenteB)).toEqual(expect.objectContaining({ primera_accion: a("16:20").toISOString(), ultima_accion: a("16:20").toISOString(), tareas_que_cerro: 0, tomadas: 1, vencidas: 0 }));
    expect(res.body.automatizacion).toEqual({ correos: 3, tareas_creadas: 1 });
    expect(res.body.quedo_pendiente).toEqual([expect.objectContaining({ tarea_id: t3, titulo: `NO SE ${marca}`, responsable_id: agenteA, fecha_limite: a("12:09").toISOString() })]);
  });

  it("filtrar por persona deja solo lo suyo; un agente siempre ve solo lo suyo", async () => {
    const deA = await dia(adminCookie, { usuarioId: agenteA, limit: 100 });
    expect(deA.body.bitacora.data.map((e: { subtipo: string }) => e.subtipo)).toEqual(["cerrada", "subido", "vencida"]);
    expect(deA.body.resumen.correos).toBeNull();
    expect(deA.body.resumen.tareas_cerradas).toEqual({ cerradas: 1, vencian_ese_dia: 2 });
    expect(deA.body.por_persona.map((p: { usuario_id: number }) => p.usuario_id)).toEqual([agenteA]);
    expect(deA.body.automatizacion).toBeNull();

    const comoAgente = await dia(agenteACookie, { usuarioId: agenteB, limit: 100 });
    expect(comoAgente.status).toBe(200);
    expect(comoAgente.body.bitacora.data.map((e: { subtipo: string }) => e.subtipo)).toEqual(["cerrada", "subido", "vencida"]);
    expect(comoAgente.body.para_revisar.avisos_fallidos).toBeNull();
  });

  it("valida la fecha y exporta la bitácora completa en CSV", async () => {
    expect((await api().get("/api/v1/reportes/dia").set("Cookie", adminCookie)).status).toBe(400);
    expect((await dia(adminCookie, { tipo: "inventado" })).status).toBe(400);

    const csv = await api().get("/api/v1/reportes/export/dia").set("Cookie", adminCookie).query({ fecha: FECHA });
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    // Sin el BOM que pone toCsv para Excel.
    const lineas = csv.text.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(lineas[0]).toBe("hora,tipo,quien,que,empresa");
    expect(lineas).toHaveLength(14);
    expect(lineas[1]).toMatch(/^18:10,tareas,Agente de prueba,/);
    expect(csv.text).toContain("Automatización");
  });

  // Otro día fijo (12-mar-2025) para no mover los conteos de arriba.
  describe("fallas de workflows de n8n y quién cerró qué", () => {
    const FECHA2 = "2025-03-12";
    const b = (hhmm: string) => new Date(`${FECHA2}T${hhmm}:00-06:00`);

    beforeAll(async () => {
      // B4 (Error Workflow): un workflow de n8n que falló, con y sin nodo.
      // Y un aviso de la API (outbox) que falló, que sigue como antes.
      await db.insert(procesosFallidos).values([
        { executionId: randomUUID(), tipo: "error_workflow_n8n", workflow: "PT1 Prospección", nodo: "Armar correo SendGrid", payload: {}, mensaje: "timeout", creadoEn: b("09:00") },
        { executionId: randomUUID(), tipo: "error_workflow_n8n", workflow: "PT2 Respuestas", nodo: null, payload: {}, mensaje: "x", creadoEn: b("10:00") },
        { tipo: "outbox", payload: {}, mensaje: "n8n no respondió a tiempo", creadoEn: b("11:00") }
      ]);
      // Tarea de A que cerró el administrador: cuenta para A como responsable,
      // pero la cerró el admin.
      const [t] = await db.insert(tareas).values({ titulo: `Cerrada por otro ${marca}`, responsableId: agenteA, creadaPor: adminId, creadoEn: new Date(`${FECHA2}T07:00:00-06:00`), estado: "cerrada", resultado: "Listo", cerradaEn: b("12:00") });
      await db.insert(auditoria).values({ usuarioId: adminId, entidad: "tarea", entidadId: t.insertId, accion: "cerrar", despues: { resultado: "Listo" }, creadoEn: b("12:00") });
    });

    it("una falla de B4 dice qué workflow de n8n falló y en qué nodo; un aviso de la API sigue igual", async () => {
      const res = await api().get("/api/v1/reportes/dia").set("Cookie", adminCookie).query({ fecha: FECHA2, tipo: "sistema" });
      expect(res.body.bitacora.data.map((e: { texto: string }) => e.texto)).toEqual([
        "falló un aviso a n8n: n8n no respondió a tiempo",
        "falló el workflow PT2 Respuestas de n8n",
        "falló el workflow PT1 Prospección de n8n (nodo Armar correo SendGrid)"
      ]);
    });

    it("con persona: el resumen cuenta las tareas cerradas DE esa persona; por persona, las que ELLA cerró", async () => {
      const deA = await api().get("/api/v1/reportes/dia").set("Cookie", adminCookie).query({ fecha: FECHA2, usuarioId: agenteA });
      expect(deA.body.resumen.tareas_cerradas.cerradas).toBe(1);
      expect(deA.body.por_persona.find((p: { usuario_id: number }) => p.usuario_id === agenteA)?.tareas_que_cerro ?? 0).toBe(0);

      const delAdmin = await api().get("/api/v1/reportes/dia").set("Cookie", adminCookie).query({ fecha: FECHA2, usuarioId: adminId });
      expect(delAdmin.body.resumen.tareas_cerradas.cerradas).toBe(0);
      expect(delAdmin.body.por_persona.find((p: { usuario_id: number }) => p.usuario_id === adminId).tareas_que_cerro).toBe(1);
    });
  });
});
