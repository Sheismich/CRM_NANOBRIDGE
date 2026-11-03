import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, contactos, empresas, notificaciones, prospectos, tareas, usuarios } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Reparto automático de "Contactar prospecto interesado" (Fabián, 3-nov-2026):
// con el interruptor prendido, la tarea le toca a quien tenga menos
// interesados abiertos de la lista que se elige en Administración. Si la
// empresa ya es de un agente activo, va con él. Apagado (como empieza), nace
// sin asignar, igual que antes.
describe("reparto de interesados", () => {
  let app: INestApplication;
  let admin: string[];
  let adminId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const yo = async (cookie: string[]) => (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number;

  async function agenteNuevo() {
    const cookie = await crearAgente(app, admin, `reparto.${randomUUID()}@test.local`);
    return { cookie, id: await yo(cookie) };
  }

  const configurar = (cookie: string[], body: Record<string, unknown>) => api().put("/api/v1/tareas/reparto-interesados").set("Cookie", cookie).send(body);

  async function interesado() {
    const prospecto = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Reparto ${randomUUID()}` }, contacto: { nombre: "Persona Reparto", correo: `reparto.${randomUUID()}@cliente.test` } });
    expect(prospecto.status).toBe(201);
    const prospectoId = prospecto.body.id as number;
    const respuesta = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido: "Me interesa" });
    expect(respuesta.status).toBe(201);
    const clasificada = await api().post("/api/v1/automatizacion/respuestas/clasificacion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), respuesta_id: respuesta.body.id, clasificacion: "interesado" });
    expect(clasificada.status).toBe(201);
    const [tarea] = await db.select().from(tareas).where(and(eq(tareas.prospectoId, prospectoId), eq(tareas.titulo, "Contactar prospecto interesado")));
    return { prospectoId, tarea: tarea!, respuestaId: respuesta.body.id as number };
  }

  async function duenoDe(empresaId: number) {
    const [e] = await db.select({ propietarioId: empresas.propietarioId }).from(empresas).where(eq(empresas.id, empresaId));
    return e!.propietarioId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    adminId = await yo(admin);
  });

  // La configuración es una sola para toda la base de pruebas: siempre se
  // deja apagada para no cambiar lo que esperan los demás archivos.
  afterEach(async () => {
    expect((await configurar(admin, { activo: false, usuarioIds: [] })).status).toBe(200);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("empieza apagado: la tarea nace sin asignar, como antes", async () => {
    const res = await api().get("/api/v1/tareas/reparto-interesados").set("Cookie", admin);
    expect(res.status).toBe(200);
    expect(res.body.activo).toBe(false);
    expect((await interesado()).tarea.responsableId).toBeNull();
  });

  it("prendido: le toca a quien tenga menos interesados abiertos, y empata el que hace más que no recibe", async () => {
    const a = await agenteNuevo();
    const b = await agenteNuevo();
    expect((await configurar(admin, { activo: true, usuarioIds: [a.id, b.id] })).status).toBe(200);

    const primero = await interesado();
    const segundo = await interesado();
    const tercero = await interesado();
    expect(primero.tarea.responsableId).toBe(a.id);
    expect(segundo.tarea.responsableId).toBe(b.id);
    expect(tercero.tarea.responsableId).toBe(a.id);

    // Asignar = dar dueño: el agente ya ve la ficha.
    expect(await duenoDe(primero.tarea.empresaId!)).toBe(a.id);
    expect((await api().get(`/api/v1/empresas/${primero.tarea.empresaId}`).set("Cookie", a.cookie)).status).toBe(200);

    // Queda en la auditoría de la tarea.
    const [asignacion] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "tarea"), eq(auditoria.entidadId, primero.tarea.id), eq(auditoria.accion, "asignar")));
    expect(asignacion!.despues).toEqual(expect.objectContaining({ responsable_id: a.id, motivo: "reparto_automatico" }));

    // Al cerrar una, ese agente vuelve a tener menos.
    expect((await api().patch(`/api/v1/tareas/${segundo.tarea.id}/cerrar`).set("Cookie", b.cookie).send({ resultado: "Listo" })).status).toBe(200);
    expect((await interesado()).tarea.responsableId).toBe(b.id);
  });

  it("al asignado le llega el aviso de interesado, con la liga a su tarea", async () => {
    const a = await agenteNuevo();
    expect((await configurar(admin, { activo: true, usuarioIds: [a.id] })).status).toBe(200);
    const { tarea } = await interesado();
    const avisos = await db.select().from(notificaciones).where(and(eq(notificaciones.usuarioId, a.id), eq(notificaciones.entidadId, tarea.id))).orderBy(desc(notificaciones.id));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.tipo).toBe("interesado");
    expect(avisos[0]!.enlace).toContain(`tarea=${tarea.id}`);
  });

  it("si la empresa ya es de un agente activo, va con él aunque no esté en la lista", async () => {
    const dueno = await agenteNuevo();
    const otro = await agenteNuevo();
    expect((await configurar(admin, { activo: true, usuarioIds: [otro.id] })).status).toBe(200);
    // Prospecto nuevo de una empresa que ya es del agente.
    const prospecto = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Con Dueño ${randomUUID()}` }, contacto: { nombre: "Persona", correo: `dueno.${randomUUID()}@cliente.test` } });
    const [{ empresaId }] = await db.select({ empresaId: contactos.empresaId }).from(prospectos).innerJoin(contactos, eq(contactos.id, prospectos.contactoId)).where(eq(prospectos.id, prospecto.body.id));
    await db.update(empresas).set({ propietarioId: dueno.id }).where(eq(empresas.id, empresaId));
    const respuesta = await api().post("/api/v1/automatizacion/respuestas").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: prospecto.body.id, canal: "correo", contenido: "Sí" });
    await api().post("/api/v1/automatizacion/respuestas/clasificacion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), respuesta_id: respuesta.body.id, clasificacion: "interesado" });
    const [tarea] = await db.select().from(tareas).where(and(eq(tareas.prospectoId, prospecto.body.id), eq(tareas.titulo, "Contactar prospecto interesado")));
    expect(tarea!.responsableId).toBe(dueno.id);
  });

  it("un desactivado de la lista no recibe; con nadie disponible queda sin asignar", async () => {
    const a = await agenteNuevo();
    expect((await configurar(admin, { activo: true, usuarioIds: [a.id] })).status).toBe(200);
    await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, a.id));
    expect((await interesado()).tarea.responsableId).toBeNull();
  });

  it("un supervisor o administrador en la lista también recibe (y no le cambia el dueño a la empresa)", async () => {
    expect((await configurar(admin, { activo: true, usuarioIds: [adminId] })).status).toBe(200);
    const { tarea } = await interesado();
    expect(tarea.responsableId).toBe(adminId);
    expect(await duenoDe(tarea.empresaId!)).toBeNull();
  });

  it("GET trae a quién se puede poner en la lista, quién está y cuántos interesados abiertos tiene", async () => {
    const a = await agenteNuevo();
    expect((await configurar(admin, { activo: true, usuarioIds: [a.id] })).status).toBe(200);
    await interesado();
    const res = await api().get("/api/v1/tareas/reparto-interesados").set("Cookie", admin);
    expect(res.body.activo).toBe(true);
    expect(res.body.usuario_ids).toEqual([a.id]);
    const fila = (res.body.usuarios as { id: number; en_reparto: boolean; abiertas: number; rol: string }[]).find((u) => u.id === a.id);
    expect(fila).toEqual(expect.objectContaining({ en_reparto: true, abiertas: 1, rol: "agente" }));
    expect((res.body.usuarios as { rol: string }[]).some((u) => u.rol === "sistema")).toBe(false);
  });

  it("solo administrador y supervisor la cambian; ids que no existen o desactivados: 400; queda en el Registro de cambios", async () => {
    const a = await agenteNuevo();
    expect((await configurar(a.cookie, { activo: true, usuarioIds: [a.id] })).status).toBe(403);
    expect((await api().get("/api/v1/tareas/reparto-interesados").set("Cookie", a.cookie)).status).toBe(403);
    expect((await configurar(admin, { activo: true, usuarioIds: [999_999_999] })).status).toBe(400);

    expect((await configurar(admin, { activo: true, usuarioIds: [a.id] })).status).toBe(200);
    const registro = await api().get("/api/v1/admin/registro-cambios").set("Cookie", admin).query({ tipo: "configuracion", limit: 20 });
    expect(registro.status).toBe(200);
    expect(JSON.stringify(registro.body)).toMatch(/reparto de interesados/i);
  });
});
