import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { envios, mediosContacto, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Contactos nuevos (lista con medios, 9-oct-2026): buscar también por
// correo, teléfono o empresa; filtrar por a quién se le puede escribir;
// los contadores de arriba y en qué va la prospección de cada persona.
describe("contactos: búsqueda amplia, filtro por estado, conteos y prospección", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let empresaId: number;
  let ana: number;
  let beto: number;
  let ceci: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `cont.busq.${Date.now()}@test.local`);

    // Ana: correo activo y prospecto con un correo enviado.
    const reg = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Moldes ${marca}` },
      contacto: { nombre: `Ana ${marca}`, correo: `ana.${marca}@moldes.test` }
    });
    const [p] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, reg.body.id));
    ana = p.contactoId;
    await db.insert(envios).values({ prospectoId: reg.body.id, canal: "correo", numeroContacto: 1, ventanaVenceEn: new Date(Date.now() + 86_400_000), ventanaEstado: "abierta", executionId: randomUUID(), enviadoEn: new Date() });
    empresaId = (await api().get(`/api/v1/contactos/${ana}`).set("Cookie", adminCookie)).body.empresa_id;

    // Beto: solo teléfono, y lo marcamos "no contactar". Ceci: solo LinkedIn (sin medio para escribir).
    const b = await api().post("/api/v1/contactos").set("Cookie", adminCookie).send({ empresaId, nombre: `Beto ${marca}`, telefono: "+52 81 5555 0101" });
    beto = b.body.id;
    await db.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(eq(mediosContacto.contactoId, beto));
    const c = await api().post("/api/v1/contactos").set("Cookie", adminCookie).send({ empresaId, nombre: `Ceci ${marca}`, correo: `ceci.${marca}@moldes.test` });
    ceci = c.body.id;
    await db.update(mediosContacto).set({ estadoContacto: "obsoleto" }).where(eq(mediosContacto.contactoId, ceci));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const ids = (res: request.Response) => res.body.data.map((c: { id: number }) => c.id).sort();

  it("busca por correo, por teléfono y por nombre de la empresa", async () => {
    const porCorreo = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ q: `ana.${marca}@` });
    expect(ids(porCorreo)).toEqual([ana]);
    const porTelefono = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ q: "5555 0101", empresaId });
    expect(ids(porTelefono)).toEqual([beto]);
    const porEmpresa = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ q: `Moldes ${marca}` });
    expect(ids(porEmpresa)).toEqual([ana, beto, ceci].sort());
  });

  it("filtra por estado: se le puede escribir, no contactar, sin medio válido", async () => {
    const escribir = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ empresaId, estado: "escribible" });
    expect(ids(escribir)).toEqual([ana]);
    const noContactar = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ empresaId, estado: "no_contactar" });
    expect(ids(noContactar)).toEqual([beto]);
    const sinMedio = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ empresaId, estado: "sin_medio" });
    expect(ids(sinMedio)).toEqual([ceci]);
  });

  it("cada contacto dice en qué va su prospección", async () => {
    const res = await api().get("/api/v1/contactos").set("Cookie", adminCookie).query({ empresaId });
    const porId = new Map(res.body.data.map((c: { id: number; prospeccion: unknown }) => [c.id, c.prospeccion]));
    expect(porId.get(ana)).toEqual({ estado: "capturado", envios: 1 });
    expect(porId.get(beto)).toBeNull();
  });

  it("conteos de arriba, con el mismo alcance que la lista", async () => {
    const res = await api().get("/api/v1/contactos/conteos").set("Cookie", adminCookie).query({ empresaId });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ total: 3, escribibles: 1, no_contactar: 1, sin_medio: 1 });
    const agente = await api().get("/api/v1/contactos/conteos").set("Cookie", agenteCookie);
    expect(agente.body.total).toBe(0);
  });
});
