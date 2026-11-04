import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { auditoria, contactos, listaSupresion, mediosContacto, prospectos, tareas } from "../src/database/schema.js";

// Baja pedida fuera del correo (4-nov-2026): por teléfono o en persona, una
// persona la registra desde la ficha y hace lo mismo que el link de baja del
// pie: suprime todos sus medios, pasa sus prospectos a baja y cancela sus
// seguimientos.
describe("dar de baja desde la ficha", () => {
  let app: INestApplication;
  let admin: string[];
  let adminId: number;
  let agente: string[];
  let otroAgente: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const baja = (cookie: string[], contactoId: number, body: Record<string, unknown> = { motivo: "Pidió la baja por teléfono" }) =>
    api().post(`/api/v1/contactos/${contactoId}/baja`).set("Cookie", cookie).send(body);

  // Empresa con una persona (correo y teléfono); devuelve los ids.
  async function persona(cookie: string[]) {
    const correo = `baja.${randomUUID()}@cliente.test`;
    const empresa = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal: `Baja ${randomUUID().slice(0, 8)}`, contactos: [{ nombre: "Persona Baja", correo, telefono: `55${Date.now().toString().slice(-8)}` }] });
    expect(empresa.status).toBe(201);
    const lista = await api().get("/api/v1/contactos").query({ empresaId: empresa.body.id }).set("Cookie", cookie);
    return { empresaId: empresa.body.id as number, contactoId: lista.body.data[0].id as number, correo };
  }

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", admin)).body.id;
    agente = await crearAgente(app, admin, `agente.baja.${randomUUID()}@test.local`);
    otroAgente = await crearAgente(app, admin, `otro.baja.${randomUUID()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("suprime todos sus medios, pasa su prospecto a baja, cancela sus seguimientos y sale en el Historial", async () => {
    const { empresaId, contactoId, correo } = await persona(admin);
    const prospecto = await api().post("/api/v1/prospectos/desde-contacto").set("Cookie", admin).send({ contactoId });
    expect(prospecto.status).toBe(201);
    const tarea = await api().post("/api/v1/tareas").set("Cookie", admin).send({ tipo: "seguimiento", titulo: "Llamarle", responsableId: adminId, empresaId, contactoId });
    expect(tarea.status).toBe(201);

    const res = await baja(admin, contactoId);
    expect(res.status).toBe(200);
    expect(res.body.supresion_ids).toHaveLength(2);
    expect(res.body.prospectos_en_baja).toEqual([prospecto.body.id]);
    expect(res.body.tareas_canceladas).toContain(tarea.body.id);

    const medios = await db.select().from(mediosContacto).where(eq(mediosContacto.contactoId, contactoId));
    expect(medios.every((m) => m.estadoContacto === "no_contactar")).toBe(true);
    const [suprimido] = await db.select().from(listaSupresion).where(and(eq(listaSupresion.tipo, "correo"), eq(listaSupresion.valorNormalizado, correo)));
    expect(suprimido?.motivo).toBe("Pidió la baja por teléfono");
    expect((await db.select().from(prospectos).where(eq(prospectos.id, prospecto.body.id)))[0]!.estado).toBe("baja");
    expect((await db.select().from(tareas).where(eq(tareas.id, tarea.body.id)))[0]!.estado).toBe("cancelada");

    const historial = await api().get("/api/v1/actividades").query({ empresaId, limit: 100 }).set("Cookie", admin);
    expect(historial.body.data).toContainEqual(expect.objectContaining({ tipo: "cambio_estado_prospecto", resultado: "baja", responsable_id: adminId, detalle: expect.objectContaining({ motivo: "Pidió la baja por teléfono" }) }));
  });

  it("repetirla no cambia nada ni deja otra fila en la bitácora", async () => {
    const { contactoId } = await persona(admin);
    const prospecto = await api().post("/api/v1/prospectos/desde-contacto").set("Cookie", admin).send({ contactoId });
    expect((await baja(admin, contactoId)).status).toBe(200);

    const otra = await baja(admin, contactoId);
    expect(otra.status).toBe(200);
    expect(otra.body.prospectos_en_baja).toEqual([]);
    const filas = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, prospecto.body.id), eq(auditoria.accion, "dar_de_baja_desde_ficha")));
    expect(filas).toHaveLength(1);
  });

  it("un agente da de baja a las personas de sus empresas; las de otro agente no las ve (404)", async () => {
    const suya = await persona(agente);
    expect((await baja(agente, suya.contactoId)).status).toBe(200);
    const ajena = await persona(otroAgente);
    expect((await baja(agente, ajena.contactoId)).status).toBe(404);
  });

  it("pide el motivo (400) y sesión (401)", async () => {
    const { contactoId } = await persona(admin);
    expect((await baja(admin, contactoId, {})).status).toBe(400);
    expect((await baja(admin, contactoId, { motivo: " " })).status).toBe(400);
    expect((await api().post(`/api/v1/contactos/${contactoId}/baja`).send({ motivo: "Por teléfono" })).status).toBe(401);
  });

  it("sin correo, teléfono ni WhatsApp no hay nada que bloquear: 409", async () => {
    const { empresaId } = await persona(admin);
    const [sinMedios] = await db.insert(contactos).values({ empresaId, nombre: "Sin Medios" });
    const res = await baja(admin, sinMedios.insertId);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/no hay nada que dar de baja/);
  });
});
