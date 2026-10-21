import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { validarParaEnvio } from "./support/prospectos.js";
import { correosRespuesta, empresas, envios, mediosContacto, notificaciones, prospectos, respuestas, tareas, usoIa, usuarios } from "../src/database/schema.js";
import { CORREO_SERVICE } from "../src/integraciones/correo.types.js";
import { IA_SERVICE } from "../src/integraciones/ia.types.js";
import type { CorreoFalsoDriver } from "../src/integraciones/correo-falso.driver.js";
import type { IaFalsaDriver } from "../src/integraciones/ia-falsa.driver.js";
import { firmarReplyTo } from "../src/shared/reply-to.js";
import { cuerpoSendgrid } from "../src/integraciones/correo-sendgrid.driver.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Etapa 3 de las mejoras (plan aprobado por Fabián el 20-oct-2026): el
// vendedor le contesta al prospecto desde el CRM, con un borrador opcional de
// la IA. El correo sale como "<vendedor> · NANOBRIDGE" con el Reply-To
// firmado del envío, así la respuesta del cliente regresa sola por PT2.
describe("responder al prospecto desde el CRM", () => {
  let app: INestApplication;
  let admin: string[];
  let supervisor: string[];
  let agente: string[];
  let otroAgente: string[];
  let agenteId: number;
  let supervisorId: number;
  let correo: CorreoFalsoDriver;
  let ia: IaFalsaDriver;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const yo = async (cookie: string[]) => (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body as { id: number; nombre: string };

  // Un prospecto con su primer correo y una respuesta. `clasificacion`
  // decide cómo queda la respuesta (por la cola, como una persona).
  async function respuestaDe(opciones: { clasificacion?: "interesado" | "ambigua" | "no_interesado" | "baja" | null; contenido?: string; messageId?: string; asunto?: string } = {}) {
    const empresa = `Responder ${randomUUID().slice(0, 8)}`;
    const correoContacto = `cliente.${randomUUID()}@prospeccion.test`;
    const reg = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: empresa, giro: "Manufactura" },
      contacto: { nombre: "Laura Gómez", correo: correoContacto }
    });
    expect(reg.status).toBe(201);
    const prospectoId = reg.body.id as number;
    const empresaId = reg.body.empresa_id as number;
    await validarParaEnvio(db, prospectoId);
    const envio = await api().post("/api/v1/automatizacion/envios").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" });
    expect(envio.status).toBe(201);
    const resp = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      reply_to: envio.body.reply_to,
      canal: "correo",
      contenido: opciones.contenido ?? "Me interesa, ¿me pueden mandar más información?",
      crear_tarea_clasificacion: true,
      ...(opciones.messageId ? { message_id: opciones.messageId } : {}),
      ...(opciones.asunto ? { asunto: opciones.asunto } : {})
    });
    expect(resp.status).toBe(201);
    const respuestaId = resp.body.id as number;
    let tareaInteresadoId: number | null = null;
    const clasificacion = opciones.clasificacion === undefined ? "interesado" : opciones.clasificacion;
    if (clasificacion === "ambigua") {
      // "ambigua" solo la pone n8n; una persona no la elige en la cola.
      const clasificar = await api().post("/api/v1/automatizacion/respuestas/clasificacion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion });
      expect(clasificar.status).toBe(201);
    } else if (clasificacion) {
      const clasificar = await api().post(`/api/v1/cola-clasificacion/${resp.body.tarea_id}/clasificar`).set("Cookie", supervisor).send({ clasificacion });
      expect(clasificar.status).toBe(200);
      const [t] = await db.select({ id: tareas.id }).from(tareas).where(and(eq(tareas.titulo, "Contactar prospecto interesado"), eq(tareas.respuestaId, respuestaId)));
      tareaInteresadoId = t?.id ?? null;
    }
    return { empresa, empresaId, prospectoId, respuestaId, envioId: envio.body.id as number, replyTo: envio.body.reply_to as string, correoContacto, tareaInteresadoId };
  }

  const contestar = (cookie: string[], respuestaId: number, body: Record<string, unknown>) => api().post(`/api/v1/respuestas/${respuestaId}/contestar`).set("Cookie", cookie).send(body);
  const borrador = (cookie: string[], respuestaId: number) => api().post(`/api/v1/respuestas/${respuestaId}/borrador-ia`).set("Cookie", cookie).send({});

  beforeAll(async () => {
    app = await createTestApp();
    correo = app.get(CORREO_SERVICE);
    ia = app.get(IA_SERVICE);
    admin = await ensureSeedAdmin(app);
    const correoSupervisor = `sup.responder.${randomUUID()}@test.local`;
    expect((await api().post("/api/v1/usuarios").set("Cookie", admin).send({ nombre: "Supervisora Responder", correo: correoSupervisor, password: "password_sup_1", rol: "supervisor" })).status).toBe(201);
    supervisor = await loginAs(app, correoSupervisor, "password_sup_1");
    supervisorId = (await yo(supervisor)).id;
    agente = await crearAgente(app, admin, `agente.responder.${randomUUID()}@test.local`);
    agenteId = (await yo(agente)).id;
    otroAgente = await crearAgente(app, admin, `otro.responder.${randomUUID()}@test.local`);
  });

  beforeEach(() => {
    correo.fallar = false;
    ia.fallar = false;
    ia.respuesta = { texto: "Buenas tardes, Laura. Con gusto le comparto más información." };
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("sin sesión, 401", async () => {
    expect((await api().get("/api/v1/respuestas/1/contestar")).status).toBe(401);
    expect((await api().post("/api/v1/respuestas/1/contestar").send({ texto: "Hola" })).status).toBe(401);
  });

  it("el contexto trae lo que escribió el cliente, a quién va, el asunto con Re: y la firma", async () => {
    const r = await respuestaDe();
    const res = await api().get(`/api/v1/respuestas/${r.respuestaId}/contestar`).set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      respuesta_id: r.respuestaId,
      contenido: "Me interesa, ¿me pueden mandar más información?",
      para: r.correoContacto,
      contacto_nombre: "Laura Gómez",
      empresa_nombre: r.empresa,
      puede_responder: true,
      motivo: null,
      tarea_id: r.tareaInteresadoId
    }));
    expect(res.body.asunto).toMatch(/^Re: /);
    expect(res.body.firma).toContain("Admin Semilla");
    expect(res.body.firma).toContain("NANOBRIDGE");
  });

  it("manda el correo como '<vendedor> · NANOBRIDGE', con el Reply-To firmado del envío, sin contar como contacto", async () => {
    const r = await respuestaDe();
    const enviosAntes = await db.select({ id: envios.id }).from(envios).where(eq(envios.prospectoId, r.prospectoId));
    const res = await contestar(admin, r.respuestaId, { texto: "Hola Laura, con gusto le mando la información.", cerrar_tarea: false });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ estado: "enviado", tarea_cerrada: false }));

    const enviado = correo.enviados.find((c) => c.para === r.correoContacto)!;
    expect(enviado).toBeDefined();
    expect(enviado.nombreRemitente).toBe("Admin Semilla · NANOBRIDGE");
    expect(enviado.replyTo).toBe(firmarReplyTo(r.envioId));
    expect(enviado.categoria).toBe("respuesta_vendedor");
    expect(enviado.asunto).toMatch(/^Re: /);
    expect(enviado.texto).toContain("Hola Laura, con gusto le mando la información.");
    expect(enviado.texto).toContain("Admin Semilla");
    // Lo que escribió el cliente va citado abajo.
    expect(enviado.texto).toContain("> Me interesa, ¿me pueden mandar más información?");
    expect(enviado.html).toContain("<blockquote");
    // Sin Message-ID del cliente no hay cabeceras de hilo.
    expect(enviado.cabeceras).toBeUndefined();

    const [fila] = await db.select().from(correosRespuesta).where(eq(correosRespuesta.respuestaId, r.respuestaId));
    expect(fila).toEqual(expect.objectContaining({ estado: "enviado", usoIa: "sin_ia", proveedorId: expect.stringMatching(/^falso-/), para: r.correoContacto }));
    // P3.5: no es un envío de prospección.
    expect(await db.select({ id: envios.id }).from(envios).where(eq(envios.prospectoId, r.prospectoId))).toHaveLength(enviosAntes.length);
    // La tarea sigue abierta porque se pidió no cerrarla.
    const [tarea] = await db.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, r.tareaInteresadoId!));
    expect(tarea!.estado).not.toBe("cerrada");
  });

  it("con Message-ID del cliente manda In-Reply-To y References, y usa su asunto", async () => {
    const r = await respuestaDe({ messageId: "<abc123@mail.gmail.com>", asunto: "RE: Propuesta para Moldes" });
    const res = await contestar(admin, r.respuestaId, { texto: "Gracias por su respuesta.", cerrar_tarea: true });
    expect(res.status).toBe(201);
    const enviado = correo.enviados.find((c) => c.para === r.correoContacto)!;
    expect(enviado.cabeceras).toEqual({ "In-Reply-To": "<abc123@mail.gmail.com>", References: "<abc123@mail.gmail.com>" });
    // Ya traía "RE:": no se le pone otro.
    expect(enviado.asunto).toBe("RE: Propuesta para Moldes");
    // SendGrid recibe las cabeceras.
    expect(cuerpoSendgrid(enviado).headers).toEqual({ "In-Reply-To": "<abc123@mail.gmail.com>", References: "<abc123@mail.gmail.com>" });
  });

  it("cerrar_tarea cierra la tarea 'Contactar prospecto interesado'", async () => {
    const r = await respuestaDe();
    const res = await contestar(admin, r.respuestaId, { texto: "Le marco mañana.", cerrar_tarea: true });
    expect(res.status).toBe(201);
    expect(res.body.tarea_cerrada).toBe(true);
    const [tarea] = await db.select({ estado: tareas.estado, resultado: tareas.resultado }).from(tareas).where(eq(tareas.id, r.tareaInteresadoId!));
    expect(tarea).toEqual({ estado: "cerrada", resultado: "Respondido por correo desde el CRM" });
  });

  describe("permisos (P3.2)", () => {
    it("un agente ajeno no la ve (404); el dueño de la empresa sí puede", async () => {
      const r = await respuestaDe();
      expect((await api().get(`/api/v1/respuestas/${r.respuestaId}/contestar`).set("Cookie", agente)).status).toBe(404);
      expect((await contestar(agente, r.respuestaId, { texto: "Hola" })).status).toBe(404);

      await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, r.empresaId));
      expect((await contestar(otroAgente, r.respuestaId, { texto: "Hola" })).status).toBe(404);
      const res = await contestar(agente, r.respuestaId, { texto: "Hola, soy su asesor." });
      expect(res.status).toBe(201);
      expect(correo.enviados.find((c) => c.para === r.correoContacto)!.nombreRemitente).toBe("Agente de prueba · NANOBRIDGE");
    });

    it("el responsable de la tarea puede aunque la empresa no sea suya", async () => {
      const r = await respuestaDe();
      expect((await api().patch(`/api/v1/tareas/${r.tareaInteresadoId}/asignar`).set("Cookie", supervisor).send({ responsableId: agenteId })).status).toBe(200);
      // Asignar le da la empresa al agente (darEmpresaAlAgente); se le quita
      // para probar solo la regla de la tarea.
      await db.update(empresas).set({ propietarioId: supervisorId }).where(eq(empresas.id, r.empresaId));
      expect((await contestar(agente, r.respuestaId, { texto: "Hola" })).status).toBe(201);
    });
  });

  describe("a qué se puede contestar (P3.1)", () => {
    it("ambigua sí; no_interesado, baja y sin clasificar no (409 con motivo)", async () => {
      const ambigua = await respuestaDe({ clasificacion: "ambigua" });
      expect((await contestar(admin, ambigua.respuestaId, { texto: "¿Me podría aclarar?" })).status).toBe(201);

      for (const clasificacion of ["no_interesado", "baja", null] as const) {
        const r = await respuestaDe({ clasificacion });
        const ctx = await api().get(`/api/v1/respuestas/${r.respuestaId}/contestar`).set("Cookie", admin);
        expect(ctx.status).toBe(200);
        expect(ctx.body.puede_responder).toBe(false);
        expect(ctx.body.motivo).toEqual(expect.any(String));
        const res = await contestar(admin, r.respuestaId, { texto: "Hola" });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("NO_SE_PUEDE_RESPONDER");
      }
    });

    it("con el correo en no_contactar, no se manda", async () => {
      const r = await respuestaDe();
      await db.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(eq(mediosContacto.valorNormalizado, r.correoContacto.toLowerCase()));
      const res = await contestar(admin, r.respuestaId, { texto: "Hola" });
      expect(res.status).toBe(409);
      expect(correo.enviados.some((c) => c.para === r.correoContacto)).toBe(false);
    });

    it("texto vacío o demasiado largo: 400", async () => {
      const r = await respuestaDe();
      expect((await contestar(admin, r.respuestaId, { texto: "   " })).status).toBe(400);
      expect((await contestar(admin, r.respuestaId, { texto: "a".repeat(5001) })).status).toBe(400);
    });
  });

  describe("cuando SendGrid falla", () => {
    it("la fila queda 'fallido', responde 502 y la tarea sigue abierta; se puede reintentar", async () => {
      const r = await respuestaDe();
      correo.fallar = true;
      const res = await contestar(admin, r.respuestaId, { texto: "Hola Laura", cerrar_tarea: true });
      expect(res.status).toBe(502);
      const [fila] = await db.select().from(correosRespuesta).where(eq(correosRespuesta.respuestaId, r.respuestaId));
      expect(fila).toEqual(expect.objectContaining({ estado: "fallido", error: expect.stringContaining("falla simulada") }));
      const [tarea] = await db.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, r.tareaInteresadoId!));
      expect(tarea!.estado).not.toBe("cerrada");

      correo.fallar = false;
      expect((await contestar(admin, r.respuestaId, { texto: "Hola Laura", cerrar_tarea: true })).status).toBe(201);
    });

    it("mientras hay uno 'enviando' de la misma respuesta, otro clic da 409 (sin doble correo)", async () => {
      const r = await respuestaDe();
      const [{ id: usuarioId }] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.nombre, "Admin Semilla")).limit(1);
      await db.insert(correosRespuesta).values({ respuestaId: r.respuestaId, prospectoId: r.prospectoId, usuarioId: usuarioId!, para: r.correoContacto, asunto: "Re: x", texto: "x", usoIa: "sin_ia", estado: "enviando" });
      const res = await contestar(admin, r.respuestaId, { texto: "Hola" });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("RESPUESTA_ENVIANDO");
    });

    // Revisión de Fabián (21-oct-2026): si Cloud Run reinicia entre el
    // 'enviando' y el update, la fila no debe trabar la respuesta para siempre.
    it("un 'enviando' de hace más de 5 minutos ya no traba: se marca 'fallido' y se manda (201)", async () => {
      const r = await respuestaDe();
      const [{ id: usuarioId }] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.nombre, "Admin Semilla")).limit(1);
      const [vieja] = await db.insert(correosRespuesta).values({ respuestaId: r.respuestaId, prospectoId: r.prospectoId, usuarioId: usuarioId!, para: r.correoContacto, asunto: "Re: x", texto: "x", usoIa: "sin_ia", estado: "enviando" });
      await db.update(correosRespuesta).set({ creadoEn: sql`NOW() - INTERVAL 10 MINUTE` }).where(eq(correosRespuesta.id, vieja.insertId));
      const res = await contestar(admin, r.respuestaId, { texto: "Hola de nuevo" });
      expect(res.status).toBe(201);
      const [fila] = await db.select({ estado: correosRespuesta.estado, error: correosRespuesta.error }).from(correosRespuesta).where(eq(correosRespuesta.id, vieja.insertId));
      expect(fila!.estado).toBe("fallido");
      expect(fila!.error).toContain("Sin confirmación");
    });
  });

  describe("borrador con IA", () => {
    it("regresa el texto de la IA, con lo que escribió el cliente y el correo que se le mandó, sin montos", async () => {
      const r = await respuestaDe({ contenido: "Sí me interesa, ¿cuánto cuesta?" });
      const res = await borrador(admin, r.respuestaId);
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ borrador_id: expect.any(Number), texto: "Buenas tardes, Laura. Con gusto le comparto más información." });
      const pregunta = ia.preguntas.at(-1)!;
      expect(pregunta.texto).toContain("Sí me interesa, ¿cuánto cuesta?");
      expect(pregunta.texto).toContain(r.empresa);
      expect(pregunta.texto).toContain("Manufactura");
      expect(pregunta.texto).toContain("Admin Semilla");
      expect(pregunta.instrucciones).toMatch(/de usted/i);
      expect(pregunta.instrucciones).toMatch(/precios/i);
    });

    it("uso_ia: tal_cual si se manda igual, editado si se cambió", async () => {
      const r1 = await respuestaDe();
      const b1 = (await borrador(admin, r1.respuestaId)).body;
      expect((await contestar(admin, r1.respuestaId, { texto: b1.texto, borrador_id: b1.borrador_id })).status).toBe(201);
      const [f1] = await db.select({ usoIa: correosRespuesta.usoIa }).from(correosRespuesta).where(eq(correosRespuesta.respuestaId, r1.respuestaId));
      expect(f1!.usoIa).toBe("tal_cual");

      const r2 = await respuestaDe();
      const b2 = (await borrador(admin, r2.respuestaId)).body;
      expect((await contestar(admin, r2.respuestaId, { texto: `${b2.texto} Saludos.`, borrador_id: b2.borrador_id })).status).toBe(201);
      const [f2] = await db.select({ usoIa: correosRespuesta.usoIa }).from(correosRespuesta).where(eq(correosRespuesta.respuestaId, r2.respuestaId));
      expect(f2!.usoIa).toBe("editado");
    });

    it("si la IA falla: 502 con mensaje para escribirlo a mano", async () => {
      const r = await respuestaDe();
      ia.fallar = true;
      const res = await borrador(admin, r.respuestaId);
      expect(res.status).toBe(502);
      expect(res.body.message).toMatch(/escr[ií]belo/i);
    });

    it("máximo 20 borradores por persona al día (429)", async () => {
      const r = await respuestaDe();
      // Se llenan 20 usos de hoy directo en la tabla.
      await db.insert(usoIa).values(Array.from({ length: 20 }, () => ({ usuarioId: supervisorId, tipo: "borrador_respuesta" as const, respuestaId: r.respuestaId, resultado: "x" })));
      const res = await borrador(supervisor, r.respuestaId);
      expect(res.status).toBe(429);
      expect((await borrador(admin, r.respuestaId)).status).toBe(201);
    });
  });

  it("el Historial de la ficha muestra 'correo_respondido' (solo los enviados)", async () => {
    const r = await respuestaDe();
    correo.fallar = true;
    await contestar(admin, r.respuestaId, { texto: "Primer intento" });
    correo.fallar = false;
    await contestar(admin, r.respuestaId, { texto: "Segundo intento" });
    const res = await api().get("/api/v1/actividades").set("Cookie", admin).query({ empresaId: r.empresaId });
    expect(res.status).toBe(200);
    const respondidos = res.body.data.filter((e: { tipo: string }) => e.tipo === "correo_respondido");
    expect(respondidos).toHaveLength(1);
    expect(respondidos[0]).toEqual(expect.objectContaining({ canal: "correo", detalle: expect.objectContaining({ respuesta_id: r.respuestaId, texto: "Segundo intento", usuario_nombre: "Admin Semilla" }) }));
  });

  describe("conversación (caso de Fabián)", () => {
    it("si el cliente vuelve a contestar, le llega aviso con correo al vendedor y no nace 'Clasificar respuesta tardía'", async () => {
      const r = await respuestaDe();
      await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, r.empresaId));
      expect((await contestar(agente, r.respuestaId, { texto: "Hola Laura, le mando la información." })).status).toBe(201);

      const otra = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), reply_to: r.replyTo, canal: "correo", contenido: "Perfecto, gracias. ¿Cuándo podemos hablar?", crear_tarea_clasificacion: true });
      expect(otra.status).toBe(201);
      expect(otra.body).toEqual(expect.objectContaining({ identificada: true, tardia: true, tarea_id: null, en_conversacion: true }));
      const tareasDeLaNueva = await db.select({ id: tareas.id }).from(tareas).where(eq(tareas.respuestaId, otra.body.id));
      expect(tareasDeLaNueva).toHaveLength(0);

      const [aviso] = await db.select().from(notificaciones).where(and(eq(notificaciones.usuarioId, agenteId), eq(notificaciones.tipo, "respuesta_conversacion"), eq(notificaciones.entidadId, otra.body.id)));
      expect(aviso).toEqual(expect.objectContaining({ titulo: `Laura Gómez te contestó · ${r.empresa}`, enlace: `/empresas/${r.empresaId}?tab=historial`, correoEstado: "enviado" }));
      expect(aviso!.cuerpo).toContain("¿Cuándo podemos hablar?");

      // Y esa respuesta nueva se puede contestar aunque nadie la clasificó.
      const ctx = await api().get(`/api/v1/respuestas/${otra.body.id}/contestar`).set("Cookie", agente);
      expect(ctx.body.puede_responder).toBe(true);
    });

    it("una automática no avisa", async () => {
      const r = await respuestaDe();
      expect((await contestar(admin, r.respuestaId, { texto: "Hola" })).status).toBe(201);
      const auto = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), reply_to: r.replyTo, canal: "correo", contenido: "Fuera de oficina", automatica: true });
      expect(auto.status).toBe(201);
      expect(await db.select().from(notificaciones).where(and(eq(notificaciones.tipo, "respuesta_conversacion"), eq(notificaciones.entidadId, auto.body.id)))).toHaveLength(0);
    });

    it("si el vendedor ya no está activo, el aviso va a admins y supervisores", async () => {
      const r = await respuestaDe();
      const correoTemporal = `temporal.${randomUUID()}@test.local`;
      const temporal = await crearAgente(app, admin, correoTemporal);
      const temporalId = (await yo(temporal)).id;
      await db.update(empresas).set({ propietarioId: temporalId }).where(eq(empresas.id, r.empresaId));
      expect((await contestar(temporal, r.respuestaId, { texto: "Hola" })).status).toBe(201);
      expect((await api().delete(`/api/v1/usuarios/${temporalId}`).set("Cookie", admin)).status).toBeLessThan(300);

      const otra = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), reply_to: r.replyTo, canal: "correo", contenido: "¿Siguen ahí?", crear_tarea_clasificacion: true });
      expect(otra.status).toBe(201);
      const avisos = await db.select({ usuarioId: notificaciones.usuarioId }).from(notificaciones).where(and(eq(notificaciones.tipo, "respuesta_conversacion"), eq(notificaciones.entidadId, otra.body.id)));
      expect(avisos.map((a) => a.usuarioId)).toContain(supervisorId);
      expect(avisos.map((a) => a.usuarioId)).not.toContain(temporalId);
    });

    // Revisión de Fabián (21-oct-2026, aprobado): el vendedor ya recibió "te
    // contestó"; un "interesado" (de la IA o manual) solo guarda la
    // clasificación. La baja sí se aplica siempre.
    async function enConversacion(cerrarTarea: boolean) {
      const r = await respuestaDe();
      expect((await contestar(admin, r.respuestaId, { texto: "Hola Laura, le mando la información.", cerrar_tarea: cerrarTarea })).status).toBe(201);
      const otra = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), reply_to: r.replyTo, canal: "correo", contenido: "Sí, ¿cuándo me llaman?", crear_tarea_clasificacion: true });
      expect(otra.status).toBe(201);
      expect(otra.body.en_conversacion).toBe(true);
      return { r, otraId: otra.body.id as number };
    }
    const clasificarConIa = (respuestaId: number, clasificacion: string) =>
      api().post("/api/v1/automatizacion/respuestas/clasificacion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion });
    const tareasInteresado = (prospectoId: number) =>
      db.select({ id: tareas.id, estado: tareas.estado, descripcion: tareas.descripcion }).from(tareas).where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.titulo, "Contactar prospecto interesado")));
    const avisosInteresado = async () => Number((await db.select({ n: sql<number>`COUNT(*)` }).from(notificaciones).where(eq(notificaciones.tipo, "interesado")))[0]!.n);

    it("'interesado' de la IA con la tarea ya cerrada: no crea otra tarea ni avisa", async () => {
      const { r, otraId } = await enConversacion(true);
      const avisosAntes = await avisosInteresado();
      const res = await clasificarConIa(otraId, "interesado");
      expect(res.status).toBe(201);
      expect(res.body.tarea_id).toBeNull();
      const [fila] = await db.select({ clasificacion: respuestas.clasificacion }).from(respuestas).where(eq(respuestas.id, otraId));
      expect(fila!.clasificacion).toBe("interesado");
      const tareasDelProspecto = await tareasInteresado(r.prospectoId);
      expect(tareasDelProspecto.filter((t) => t.estado !== "cerrada")).toHaveLength(0);
      expect(await avisosInteresado()).toBe(avisosAntes);
    });

    it("'interesado' de la IA con la tarea abierta: no le agrega la respuesta ni manda 'Volvió a contestar'", async () => {
      const { r, otraId } = await enConversacion(false);
      const [antes] = await tareasInteresado(r.prospectoId);
      const avisosAntes = await avisosInteresado();
      expect((await clasificarConIa(otraId, "interesado")).status).toBe(201);
      const despues = await tareasInteresado(r.prospectoId);
      expect(despues).toHaveLength(1);
      expect(despues[0]!.descripcion).toBe(antes!.descripcion);
      expect(await avisosInteresado()).toBe(avisosAntes);
    });

    it("'baja' en una conversación sí se aplica: el correo queda en no_contactar", async () => {
      const { r, otraId } = await enConversacion(true);
      expect((await clasificarConIa(otraId, "baja")).status).toBe(201);
      const [medio] = await db.select({ estado: mediosContacto.estadoContacto }).from(mediosContacto).where(eq(mediosContacto.valorNormalizado, r.correoContacto.toLowerCase()));
      expect(medio!.estado).toBe("no_contactar");
    });
  });

  it("P3.9: un segundo 'interesado' del mismo prospecto no crea otra tarea si ya hay una abierta", async () => {
    const r = await respuestaDe();
    // Otra respuesta (sin conversación, porque no se ha contestado desde el CRM).
    const otra = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: r.prospectoId, canal: "correo", contenido: "Y también quiero cotizar otra cosa", crear_tarea_clasificacion: true });
    expect(otra.status).toBe(201);
    expect((await api().post(`/api/v1/cola-clasificacion/${otra.body.tarea_id}/clasificar`).set("Cookie", supervisor).send({ clasificacion: "interesado" })).status).toBe(200);
    const abiertas = await db.select({ id: tareas.id, descripcion: tareas.descripcion }).from(tareas).where(and(eq(tareas.prospectoId, r.prospectoId), eq(tareas.titulo, "Contactar prospecto interesado")));
    expect(abiertas).toHaveLength(1);
    expect(abiertas[0]!.descripcion).toContain("Y también quiero cotizar otra cosa");
  });

  it("guardar el Message-ID y el asunto que manda PT2 (opcionales)", async () => {
    const r = await respuestaDe({ messageId: "<m1@x.test>", asunto: "Re: Hola" });
    const [fila] = await db.select({ messageId: respuestas.messageId, asunto: respuestas.asunto }).from(respuestas).where(eq(respuestas.id, r.respuestaId));
    expect(fila).toEqual({ messageId: "<m1@x.test>", asunto: "Re: Hola" });
    const sin = await respuestaDe();
    const [filaSin] = await db.select({ messageId: respuestas.messageId }).from(respuestas).where(eq(respuestas.id, sin.respuestaId));
    expect(filaSin!.messageId).toBeNull();
    // El prospecto sigue siendo el mismo (no se rompió la identificación).
    const [p] = await db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, sin.prospectoId));
    expect(p).toBeDefined();
  });

  // Revisión de Fabián (21-oct-2026): PT2 no debe perder una respuesta del
  // cliente por un message_id vacío o un asunto/Message-ID largo.
  describe("message_id y asunto de PT2 nunca hacen fallar el registro", () => {
    async function registrar(extra: Record<string, unknown>) {
      const base = await respuestaDe({ clasificacion: null });
      const res = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: base.prospectoId, canal: "correo", contenido: "Otra respuesta", ...extra });
      expect(res.status).toBe(201);
      const [fila] = await db.select({ messageId: respuestas.messageId, asunto: respuestas.asunto }).from(respuestas).where(eq(respuestas.id, res.body.id));
      return fila!;
    }

    it("message_id vacío o con solo espacios se guarda como NULL", async () => {
      expect((await registrar({ message_id: "" })).messageId).toBeNull();
      expect((await registrar({ message_id: "   ", asunto: "" })).asunto).toBeNull();
    });

    // n8n manda null cuando el correo no trae Message-ID o asunto (Fabián, 21-oct-2026).
    it("message_id y asunto en null cuentan como 'no vino' (201, NULL)", async () => {
      const fila = await registrar({ message_id: null, asunto: null });
      expect(fila).toEqual({ messageId: null, asunto: null });
    });

    it("lo largo se recorta: asunto a 500 y Message-ID a 255", async () => {
      const fila = await registrar({ asunto: "a".repeat(600), message_id: `<${"m".repeat(300)}@x.test>` });
      expect(Array.from(fila.asunto!)).toHaveLength(500);
      expect(Array.from(fila.messageId!)).toHaveLength(255);
    });
  });
});
