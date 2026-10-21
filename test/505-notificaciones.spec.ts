import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { validarParaEnvio } from "./support/prospectos.js";
import { empresas, notificaciones, tareas } from "../src/database/schema.js";
import { CORREO_SERVICE } from "../src/integraciones/correo.types.js";
import type { CorreoFalsoDriver } from "../src/integraciones/correo-falso.driver.js";
import { CorreoSendgridDriver } from "../src/integraciones/correo-sendgrid.driver.js";
import { IaGeminiDriver } from "../src/integraciones/ia-gemini.driver.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Base de integraciones (etapa 2 de las mejoras, 19-oct-2026): la API
// habla directo con SendGrid y Gemini. Aquí sin red: fetch simulado.
describe("drivers de SendGrid y Gemini (fetch simulado)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("SendGrid: manda a mail/send sin rastreo, con categoría, y regresa el id", async () => {
    const fetchFalso = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202, headers: { "x-message-id": "abc123" } }));
    const res = await new CorreoSendgridDriver().enviar({ para: "ana@test.local", nombrePara: "Ana", asunto: "Hola", texto: "Texto", html: "<p>Texto</p>", categoria: "aviso_crm" });
    expect(res).toEqual({ id: "abc123" });
    const [url, opciones] = fetchFalso.mock.calls[0]!;
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    const cuerpo = JSON.parse(String(opciones!.body));
    expect(cuerpo.personalizations).toEqual([{ to: [{ email: "ana@test.local", name: "Ana" }] }]);
    expect(cuerpo.from).toEqual({ email: "hola@contacto.nano-bridge-mex.com", name: "CRM NANOBRIDGE" });
    expect(cuerpo.categories).toEqual(["aviso_crm"]);
    expect(cuerpo.tracking_settings.subscription_tracking.enable).toBe(false);
    expect(cuerpo.tracking_settings.click_tracking.enable).toBe(false);
  });

  it("SendGrid: un error del proveedor se lanza con el status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{\"errors\":[{\"message\":\"forbidden\"}]}", { status: 403 }));
    await expect(new CorreoSendgridDriver().enviar({ para: "a@test.local", asunto: "A", texto: "A", html: "A", categoria: "x" })).rejects.toThrow("403");
  });

  it("Gemini: pide JSON con el esquema y lee el JSON de la respuesta", async () => {
    const fetchFalso = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: "{\"resumen\":\"Todo bien\"}" }] } }] }));
    const esquema = { type: "OBJECT", properties: { resumen: { type: "STRING" } }, required: ["resumen"] };
    const res = await new IaGeminiDriver().generarJson<{ resumen: string }>({ instrucciones: "Resume", texto: "Datos", esquema });
    expect(res).toEqual({ resumen: "Todo bien" });
    const [url, opciones] = fetchFalso.mock.calls[0]!;
    expect(String(url)).toContain("/models/gemini-3.8-flash:generateContent");
    const cuerpo = JSON.parse(String(opciones!.body));
    expect(cuerpo.generationConfig).toEqual({ responseMimeType: "application/json", responseSchema: esquema });
    expect(cuerpo.systemInstruction.parts[0].text).toBe("Resume");
  });

  it("Gemini: sin texto o con error, falla", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("cuota", { status: 429 })).mockResolvedValueOnce(Response.json({ candidates: [] }));
    const pregunta = { instrucciones: "A", texto: "B", esquema: {} };
    await expect(new IaGeminiDriver().generarJson(pregunta)).rejects.toThrow("429");
    await expect(new IaGeminiDriver().generarJson(pregunta)).rejects.toThrow("no regresó texto");
  });
});

// Avisos al vendedor: campanita y, para lo que te toca, correo. Nunca se
// avisa de lo que uno mismo hizo.
describe("avisos (campanita + correo)", () => {
  let app: INestApplication;
  let admin: string[];
  let supervisor: string[];
  let agente: string[];
  let adminId: number;
  let supervisorId: number;
  let agenteId: number;
  let correoAgente: string;
  let correoSupervisor: string;
  let correo: CorreoFalsoDriver;
  const db = testDb();
  const api = () => request(app.getHttpServer());

  const yo = async (cookie: string[]) => (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body as { id: number; correo: string };
  const avisos = async (cookie: string[]) => {
    const res = await api().get("/api/v1/notificaciones").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body as { notificaciones: { id: number; tipo: string; titulo: string; cuerpo: string | null; enlace: string | null; leida: boolean; creado_en: string }[]; no_leidas: number };
  };
  const conteo = async (cookie: string[]) => (await api().get("/api/v1/notificaciones/conteo").set("Cookie", cookie)).body.no_leidas as number;
  const correosA = (para: string) => correo.enviados.filter((c) => c.para === para);

  async function crearTarea(cookie: string[], responsableId: number, titulo = `Tarea ${randomUUID().slice(0, 6)}`) {
    const res = await api().post("/api/v1/tareas").set("Cookie", cookie).send({ titulo, responsableId, prioridad: "media" });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    correo = app.get(CORREO_SERVICE);
    admin = await ensureSeedAdmin(app);
    correoSupervisor = `sup.avisos.${randomUUID()}@test.local`;
    const crear = await api().post("/api/v1/usuarios").set("Cookie", admin).send({ nombre: "Supervisora Avisos", correo: correoSupervisor, password: "password_sup_1", rol: "supervisor" });
    expect(crear.status).toBe(201);
    supervisor = await loginAs(app, correoSupervisor, "password_sup_1");
    correoAgente = `agente.avisos.${randomUUID()}@test.local`;
    agente = await crearAgente(app, admin, correoAgente);
    adminId = (await yo(admin)).id;
    supervisorId = (await yo(supervisor)).id;
    agenteId = (await yo(agente)).id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("sin sesión, 401", async () => {
    expect((await api().get("/api/v1/notificaciones")).status).toBe(401);
    expect((await api().get("/api/v1/notificaciones/conteo")).status).toBe(401);
  });

  it("asignarle una tarea a alguien: campanita y correo para esa persona, nada para quien la asignó", async () => {
    const antesAdmin = (await avisos(admin)).notificaciones.length;
    const titulo = `Llamar a Moldes ${randomUUID().slice(0, 6)}`;
    const tareaId = await crearTarea(admin, agenteId, titulo);

    const { notificaciones: lista, no_leidas } = await avisos(agente);
    const aviso = lista.find((n) => n.tipo === "tarea_asignada" && n.cuerpo?.includes(titulo));
    expect(aviso).toEqual(expect.objectContaining({ titulo: "Admin Semilla te asignó una tarea", enlace: `/tareas?vista=todas&tarea=${tareaId}`, leida: false }));
    expect(no_leidas).toBeGreaterThan(0);
    expect(await conteo(agente)).toBe(no_leidas);

    const enviado = correosA(correoAgente).find((c) => c.texto.includes(titulo));
    expect(enviado).toBeDefined();
    expect(enviado!.asunto).toBe("[NANOBRIDGE] Admin Semilla te asignó una tarea");
    expect(enviado!.texto).toContain(`https://crm.test/tareas?vista=todas&tarea=${tareaId}`);
    expect(enviado!.html).toContain(`href="https://crm.test/tareas?vista=todas&amp;tarea=${tareaId}"`);
    expect(enviado!.categoria).toBe("aviso_crm");
    const [fila] = await db.select().from(notificaciones).where(eq(notificaciones.id, aviso!.id));
    expect(fila).toEqual(expect.objectContaining({ correoEstado: "enviado", correoIntentos: 1 }));

    // Una tarea para uno mismo no avisa.
    await crearTarea(admin, adminId);
    expect((await avisos(admin)).notificaciones.length).toBe(antesAdmin);
  });

  it("reasignar avisa al nuevo responsable", async () => {
    const tareaId = await crearTarea(admin, agenteId);
    const res = await api().patch(`/api/v1/tareas/${tareaId}/asignar`).set("Cookie", admin).send({ responsableId: supervisorId });
    expect(res.status).toBe(200);
    const aviso = (await avisos(supervisor)).notificaciones.find((n) => n.tipo === "tarea_asignada" && n.enlace === `/tareas?vista=todas&tarea=${tareaId}`);
    expect(aviso).toBeDefined();
    expect(correosA(correoSupervisor).some((c) => c.texto.includes(`tarea=${tareaId}`))).toBe(true);
  });

  it("el interruptor apaga los correos, no la campanita", async () => {
    expect((await api().get("/api/v1/notificaciones/preferencias").set("Cookie", agente)).body).toEqual({ avisos_por_correo: true });
    const apagar = await api().put("/api/v1/notificaciones/preferencias").set("Cookie", agente).send({ avisos_por_correo: false });
    expect(apagar.status).toBe(200);
    expect(apagar.body).toEqual({ avisos_por_correo: false });

    const antes = correosA(correoAgente).length;
    const tareaId = await crearTarea(admin, agenteId);
    expect((await avisos(agente)).notificaciones.some((n) => n.enlace === `/tareas?vista=todas&tarea=${tareaId}`)).toBe(true);
    expect(correosA(correoAgente).length).toBe(antes);

    expect((await api().put("/api/v1/notificaciones/preferencias").set("Cookie", agente).send({ avisos_por_correo: true })).body).toEqual({ avisos_por_correo: true });
    expect((await api().put("/api/v1/notificaciones/preferencias").set("Cookie", agente).send({ avisos_por_correo: "si" })).status).toBe(400);
  });

  it("marcar leída una, marcar todas, y nadie toca los avisos ajenos", async () => {
    await crearTarea(admin, agenteId);
    await crearTarea(admin, agenteId);
    const { notificaciones: lista } = await avisos(agente);
    const primera = lista.find((n) => !n.leida)!;
    const antes = await conteo(agente);

    expect((await api().patch(`/api/v1/notificaciones/${primera.id}/leida`).set("Cookie", supervisor)).status).toBe(404);
    expect((await api().patch(`/api/v1/notificaciones/${primera.id}/leida`).set("Cookie", agente)).status).toBe(204);
    expect(await conteo(agente)).toBe(antes - 1);
    // Dos veces no falla.
    expect((await api().patch(`/api/v1/notificaciones/${primera.id}/leida`).set("Cookie", agente)).status).toBe(204);

    const todas = await api().post("/api/v1/notificaciones/leer-todas").set("Cookie", agente);
    expect(todas.status).toBe(200);
    expect(todas.body.marcadas).toBe(antes - 1);
    expect(await conteo(agente)).toBe(0);
    expect((await avisos(agente)).notificaciones.every((n) => n.leida)).toBe(true);
  });

  it("la lista trae lo más nuevo primero y se puede pedir solo lo no leído", async () => {
    const t1 = await crearTarea(admin, agenteId);
    const t2 = await crearTarea(admin, agenteId);
    const { notificaciones: lista } = await avisos(agente);
    expect(lista[0]!.enlace).toContain(`tarea=${t2}`);
    expect(lista[1]!.enlace).toContain(`tarea=${t1}`);
    const noLeidas = await api().get("/api/v1/notificaciones").set("Cookie", agente).query({ solo_no_leidas: true });
    expect(noLeidas.body.notificaciones.every((n: { leida: boolean }) => !n.leida)).toBe(true);
  });

  describe("respuestas de prospectos", () => {
    async function respuestaDeProspecto() {
      const empresa = `Avisos ${randomUUID().slice(0, 8)}`;
      const reg = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
        execution_id: randomUUID(),
        empresa: { nombreLegal: empresa },
        contacto: { nombre: "Laura Gómez", correo: `avisos.${randomUUID()}@prospeccion.test` }
      });
      expect(reg.status).toBe(201);
      const prospectoId = reg.body.id as number;
      await validarParaEnvio(db, prospectoId);
      expect((await api().post("/api/v1/automatizacion/envios").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" })).status).toBe(201);
      const resp = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido: "Me interesa, llámenme", crear_tarea_clasificacion: true });
      expect(resp.status).toBe(201);
      return { empresa, tareaClasificacionId: resp.body.tarea_id as number };
    }

    it("llega una respuesta: campanita para admins y supervisores, sin correo (el correo ya lo manda PT2)", async () => {
      const antes = correosA(correoSupervisor).length;
      const { empresa } = await respuestaDeProspecto();
      for (const cookie of [admin, supervisor]) {
        const aviso = (await avisos(cookie)).notificaciones.find((n) => n.tipo === "respuesta_por_clasificar" && n.cuerpo?.includes(empresa));
        expect(aviso).toEqual(expect.objectContaining({ titulo: "Nueva respuesta por clasificar", enlace: "/tareas?tab=cola" }));
      }
      expect(correosA(correoSupervisor).length).toBe(antes);
      expect((await avisos(agente)).notificaciones.some((n) => n.cuerpo?.includes(empresa))).toBe(false);
    });

    it("clasificada como interesado: aviso con correo a admins y supervisores, menos a quien la clasificó", async () => {
      const { empresa, tareaClasificacionId } = await respuestaDeProspecto();
      const res = await api().post(`/api/v1/cola-clasificacion/${tareaClasificacionId}/clasificar`).set("Cookie", admin).send({ clasificacion: "interesado" });
      expect(res.status).toBe(200);
      const [{ respuestaId }] = await db.select({ respuestaId: tareas.respuestaId }).from(tareas).where(eq(tareas.id, tareaClasificacionId));
      const [tarea] = await db.select({ id: tareas.id }).from(tareas).where(and(eq(tareas.titulo, "Contactar prospecto interesado"), eq(tareas.respuestaId, respuestaId!)));

      const aviso = (await avisos(supervisor)).notificaciones.find((n) => n.tipo === "interesado" && n.titulo.includes(empresa));
      expect(aviso).toEqual(expect.objectContaining({ titulo: `Prospecto interesado: ${empresa}`, enlace: `/tareas?vista=todas&alcance=sin_asignar&tarea=${tarea!.id}` }));
      expect(aviso!.cuerpo).toContain("Laura Gómez contestó que le interesa.");
      expect(correosA(correoSupervisor).some((c) => c.asunto === `[NANOBRIDGE] Prospecto interesado: ${empresa}`)).toBe(true);
      expect((await avisos(admin)).notificaciones.some((n) => n.tipo === "interesado" && n.titulo.includes(empresa))).toBe(false);
    });

    it("si la empresa ya es de un agente, a él también le llega, con la liga a la ficha", async () => {
      const { empresa, tareaClasificacionId } = await respuestaDeProspecto();
      const [{ empresaId }] = await db.select({ empresaId: empresas.id }).from(empresas).where(eq(empresas.nombreLegal, empresa));
      await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, empresaId!));
      expect((await api().post(`/api/v1/cola-clasificacion/${tareaClasificacionId}/clasificar`).set("Cookie", supervisor).send({ clasificacion: "interesado" })).status).toBe(200);
      const aviso = (await avisos(agente)).notificaciones.find((n) => n.tipo === "interesado" && n.titulo.includes(empresa));
      expect(aviso).toEqual(expect.objectContaining({ enlace: `/empresas/${empresaId}` }));
      expect((await avisos(admin)).notificaciones.some((n) => n.tipo === "interesado" && n.titulo.includes(empresa))).toBe(true);
    });
  });

  it("tarea vencida: aviso con correo al responsable; si SendGrid falla, el trabajo diario lo reintenta", async () => {
    const titulo = `Vencida ${randomUUID().slice(0, 6)}`;
    const tareaId = await crearTarea(admin, agenteId, titulo);
    await db.update(tareas).set({ fechaLimite: new Date(Date.now() - 60 * 60 * 1000) }).where(eq(tareas.id, tareaId));

    correo.fallar = true;
    try {
      const job = await api().post("/api/v1/automatizacion/jobs/sla-tareas").set("X-API-Key", API_KEY).send({});
      expect(job.status).toBe(200);
    } finally {
      correo.fallar = false;
    }
    const aviso = (await avisos(agente)).notificaciones.find((n) => n.tipo === "tarea_vencida" && n.cuerpo?.includes(titulo));
    expect(aviso).toEqual(expect.objectContaining({ titulo: `Se venció una tarea: ${titulo}`, enlace: `/tareas?vista=todas&tarea=${tareaId}` }));
    const [fallida] = await db.select().from(notificaciones).where(eq(notificaciones.id, aviso!.id));
    expect(fallida).toEqual(expect.objectContaining({ correoEstado: "fallido", correoIntentos: 1 }));
    expect(fallida!.correoError).toContain("falla simulada");

    const otraVez = await api().post("/api/v1/automatizacion/jobs/sla-tareas").set("X-API-Key", API_KEY).send({});
    expect(otraVez.body.correos_reintentados).toBeGreaterThanOrEqual(1);
    const [enviada] = await db.select().from(notificaciones).where(eq(notificaciones.id, aviso!.id));
    expect(enviada).toEqual(expect.objectContaining({ correoEstado: "enviado", correoIntentos: 2 }));
    expect(correosA(correoAgente).some((c) => c.asunto === `[NANOBRIDGE] Se venció una tarea: ${titulo}`)).toBe(true);
  });

  it("después de 3 intentos fallidos ya no se reintenta", async () => {
    const [fila] = await db.insert(notificaciones).values({ usuarioId: agenteId, tipo: "tarea_asignada", titulo: "Viejo", correoEstado: "fallido", correoIntentos: 3 });
    await api().post("/api/v1/automatizacion/jobs/sla-tareas").set("X-API-Key", API_KEY).send({});
    const [despues] = await db.select().from(notificaciones).where(eq(notificaciones.id, fila.insertId));
    expect(despues).toEqual(expect.objectContaining({ correoEstado: "fallido", correoIntentos: 3 }));
  });

  it("documento rechazado: aviso con correo a quien lo subió", async () => {
    const crear = await api().post("/api/v1/empresas").set("Cookie", admin).send({ nombreLegal: `Docs avisos ${randomUUID().slice(0, 6)}`, contactos: [{ nombre: "Contacto", correo: `doc.${randomUUID()}@test.local` }] });
    expect(crear.status).toBe(201);
    await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, crear.body.id));
    const nombre = `Acta ${randomUUID().slice(0, 6)}.pdf`;
    const subir = await api().post("/api/v1/documentos").set("Cookie", agente).field("empresaId", String(crear.body.id))
      .attach("archivo", Buffer.from("%PDF-1.4 prueba"), { filename: nombre, contentType: "application/pdf" });
    expect(subir.status).toBe(201);
    const rechazo = await api().patch(`/api/v1/documentos/${subir.body.id}/rechazar`).set("Cookie", admin).send({ motivoRechazo: "ilegible", motivoRechazoDetalle: "No se lee el sello" });
    expect(rechazo.status).toBe(200);

    const aviso = (await avisos(agente)).notificaciones.find((n) => n.tipo === "documento_rechazado" && n.titulo.includes(nombre));
    expect(aviso).toEqual(expect.objectContaining({ titulo: `Rechazaron un documento: ${nombre}` }));
    expect(aviso!.cuerpo).toContain("No se lee el sello");
    expect(aviso!.enlace).toMatch(/^\/tareas\?vista=todas&tarea=\d+$/);
    expect(correosA(correoAgente).some((c) => c.asunto === `[NANOBRIDGE] Rechazaron un documento: ${nombre}`)).toBe(true);
  });
});
