import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, contactos, prospectos } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// PT3 (Event Webhook de SendGrid) avisa con POST /automatizacion/supresion.
// Antes la API trataba igual los cuatro eventos: solo suprimía ese correo.
// Una baja por link o una queja de spam es la persona pidiendo que no la
// contacten, igual que una respuesta clasificada "baja" (regla del
// 24-sep-2026): se suprimen TODOS sus medios y sus prospectos pasan a baja.
// Un rebote no es una petición de la persona: solo ese correo deja de
// servir (decisión del 1-oct-2026).
describe("baja por evento de SendGrid (link de baja, spam, rebote)", () => {
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

  async function registrarProspecto(correo = `baja.${randomUUID()}@bajas.test`) {
    const telefono = `55${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Baja ${randomUUID()}` }, contacto: { nombre: "Persona Baja", correo, telefono } });
    expect([200, 201]).toContain(res.status);
    const [fila] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, res.body.id));
    return { id: res.body.id as number, contactoId: fila!.contactoId, correo, telefono };
  }

  function evento(valor: string, nombre?: string) {
    return api()
      .post("/api/v1/automatizacion/supresion")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), tipo: "correo", valor, motivo: `SendGrid: ${nombre ?? "sin evento"}`, ...(nombre ? { evento: nombre } : {}) });
  }

  function enSupresion(tipo: "correo" | "telefono", valor: string) {
    return api().get("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).query({ tipo, valor }).then((res) => res.body.en_supresion as boolean);
  }

  async function estado(prospectoId: number) {
    const [fila] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId));
    return fila!.estado;
  }

  it.each(["unsubscribe", "group_unsubscribe", "spamreport"])("'%s': suprime todos los medios de la persona y su prospecto pasa a baja", async (nombre) => {
    const persona = await registrarProspecto();

    const res = await evento(persona.correo, nombre);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ alcance: "persona", prospectos_en_baja: [persona.id] });

    expect(await enSupresion("correo", persona.correo)).toBe(true);
    expect(await enSupresion("telefono", persona.telefono)).toBe(true);
    expect(await estado(persona.id)).toBe("baja");
  });

  it("la baja alcanza a todos los prospectos de la persona (reingresos)", async () => {
    const correo = `baja.${randomUUID()}@bajas.test`;
    const primero = await registrarProspecto(correo);
    const segundo = await registrarProspecto(correo);
    expect(segundo.contactoId).toBe(primero.contactoId);

    const res = await evento(correo, "unsubscribe");
    expect(res.status).toBe(201);
    expect([...res.body.prospectos_en_baja].sort()).toEqual([primero.id, segundo.id].sort());
    expect(await estado(primero.id)).toBe("baja");
    expect(await estado(segundo.id)).toBe("baja");
  });

  it("el cambio a baja aparece en el Historial de la ficha de cliente", async () => {
    const persona = await registrarProspecto();
    expect((await evento(persona.correo, "spamreport")).status).toBe(201);

    const [contacto] = await db.select({ empresaId: contactos.empresaId }).from(contactos).where(eq(contactos.id, persona.contactoId));
    const historial = await api().get("/api/v1/actividades").set("Cookie", adminCookie).query({ empresaId: contacto!.empresaId, limit: 100 });
    expect(historial.status).toBe(200);
    const cambios = (historial.body.data as { tipo: string; resultado: string | null }[]).filter((e) => e.tipo === "cambio_estado_prospecto");
    expect(cambios.some((e) => e.resultado === "baja")).toBe(true);
  });

  it("'bounce': solo se suprime ese correo; el teléfono y el estado del prospecto no cambian", async () => {
    const persona = await registrarProspecto();
    const antes = await estado(persona.id);

    const res = await evento(persona.correo, "bounce");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ alcance: "medio", prospectos_en_baja: [] });

    expect(await enSupresion("correo", persona.correo)).toBe(true);
    expect(await enSupresion("telefono", persona.telefono)).toBe(false);
    expect(await estado(persona.id)).toBe(antes);
  });

  it("sin evento se comporta como antes (solo ese correo), para no romper a quien no lo manda", async () => {
    const persona = await registrarProspecto();

    const res = await evento(persona.correo);
    expect(res.status).toBe(201);
    expect(res.body.alcance).toBe("medio");
    expect(await enSupresion("telefono", persona.telefono)).toBe(false);
    expect(await estado(persona.id)).not.toBe("baja");
  });

  it("un correo que no es de nadie en el CRM: se suprime ese correo y ya", async () => {
    const correo = `desconocido.${randomUUID()}@bajas.test`;
    const res = await evento(correo, "unsubscribe");
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ alcance: "persona", prospectos_en_baja: [] });
    expect(await enSupresion("correo", correo)).toBe(true);
  });

  it("el mismo evento dos veces: 200 ya_existia, sin duplicar el cambio de estado", async () => {
    const persona = await registrarProspecto();
    expect((await evento(persona.correo, "unsubscribe")).status).toBe(201);

    const segunda = await evento(persona.correo, "unsubscribe");
    expect(segunda.status).toBe(200);
    expect(segunda.body.ya_existia).toBe(true);
    expect(segunda.body.prospectos_en_baja).toEqual([]);

    const cambios = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, persona.id), eq(auditoria.accion, "cambiar_estado_automatizacion")));
    expect(cambios).toHaveLength(1);
  });

  // Un rebote primero (solo el correo) y luego la persona usa el link en
  // otro correo suyo que sí le llegó: la baja de persona igual aplica.
  it("una baja por link después de un rebote del mismo correo igual da de baja a la persona", async () => {
    const persona = await registrarProspecto();
    expect((await evento(persona.correo, "bounce")).status).toBe(201);

    const res = await evento(persona.correo, "unsubscribe");
    expect(res.status).toBe(200);
    expect(res.body.prospectos_en_baja).toEqual([persona.id]);
    expect(await enSupresion("telefono", persona.telefono)).toBe(true);
    expect(await estado(persona.id)).toBe("baja");
  });

  it("un evento desconocido: 400", async () => {
    const persona = await registrarProspecto();
    expect((await evento(persona.correo, "open")).status).toBe(400);
  });
});
