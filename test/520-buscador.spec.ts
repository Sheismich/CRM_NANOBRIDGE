import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { asc } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { catalogoEtapaEmbudo, contactos, cotizaciones, empresas, mediosContacto, oportunidades, prospectos, tareas } from "../src/database/schema.js";

// Buscador general (etapa 5 de las mejoras, 21-oct-2026): GET /buscar busca
// a la vez en empresas, contactos, prospectos, oportunidades, cotizaciones y
// tareas, 5 por grupo, con las mismas reglas de cada lista. La base de
// pruebas es compartida: todo lo de aquí lleva la marca M en el nombre.
const GRUPOS = ["empresas", "contactos", "prospectos", "oportunidades", "cotizaciones", "tareas"] as const;
type Grupo = (typeof GRUPOS)[number];
type Fila = { id: number; titulo: string; detalle: string | null; empresa_id: number | null };
type Resultado = Record<Grupo, { data: Fila[]; hay_mas: boolean }>;

describe("GET /api/v1/buscar", () => {
  let app: INestApplication;
  let admin: string[];
  let supervisor: string[];
  let agenteA: string[];
  let agenteB: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());

  // Solo letras (la marca va en nombres y correos) y 7 dígitos para el teléfono.
  const m = `zq${randomUUID().replace(/[^a-f]/g, "").slice(0, 6)}`;
  const M = m.toUpperCase();
  // Para la paginación: no contiene M, así no llena el grupo de empresas de M.
  const M2 = `LT${M.slice(2)}Q`;
  const D = String(Math.floor(1_000_000 + Math.random() * 8_999_999));
  const ids = {} as Record<string, number>;

  const buscar = async (cookie: string[], q: string, extra: Record<string, unknown> = {}) => {
    const res = await api().get("/api/v1/buscar").query({ q, ...extra }).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body as Resultado;
  };
  const idsDe = (r: Resultado, grupo: Grupo) => r[grupo].data.map((f) => f.id);
  const yo = async (cookie: string[]) => (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number;

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    agenteA = await crearAgente(app, admin, `buscador.a.${m}@test.local`);
    agenteB = await crearAgente(app, admin, `buscador.b.${m}@test.local`);
    const correoSup = `buscador.sup.${m}@test.local`;
    expect((await api().post("/api/v1/usuarios").set("Cookie", admin).send({ nombre: "Supervisor Buscador", correo: correoSup, password: "password_sup_1", rol: "supervisor" })).status).toBe(201);
    supervisor = await loginAs(app, correoSup, "password_sup_1");
    const adminId = await yo(admin);
    const aId = await yo(agenteA);
    const bId = await yo(agenteB);
    const [etapa] = await db.select({ id: catalogoEtapaEmbudo.id }).from(catalogoEtapaEmbudo).orderBy(asc(catalogoEtapaEmbudo.orden)).limit(1);

    const empresa = async (valores: typeof empresas.$inferInsert) => (await db.insert(empresas).values(valores))[0].insertId;
    const contacto = async (valores: typeof contactos.$inferInsert) => (await db.insert(contactos).values(valores))[0].insertId;

    ids.empA = await empresa({ nombreLegal: `Comercializadora ${M} Norte SA`, nombreComercial: `La Casa del ${M}`, giro: `Giro${M}x`, propietarioId: aId });
    ids.empB = await empresa({ nombreLegal: `${M} Distribuidora Sur`, propietarioId: bId });
    ids.empInactiva = await empresa({ nombreLegal: `${M} Inactiva`, propietarioId: aId, activo: false });

    ids.cA = await contacto({ empresaId: ids.empA, nombre: `Ana ${M}` });
    ids.cB = await contacto({ empresaId: ids.empB, nombre: `Beto ${M}` });
    ids.cInactivo = await contacto({ empresaId: ids.empA, nombre: `Ines ${M}`, activo: false });
    await db.insert(mediosContacto).values([
      { contactoId: ids.cA, tipo: "correo", valor: `ana.${m}@ejemplo.test`, valorNormalizado: `ana.${m}@ejemplo.test` },
      { contactoId: ids.cA, tipo: "telefono", valor: `+52 477 ${D}`, valorNormalizado: `52477${D}` }
    ]);

    ids.pA = (await db.insert(prospectos).values({ contactoId: ids.cA, estado: "validado" }))[0].insertId;
    ids.pB = (await db.insert(prospectos).values({ contactoId: ids.cB }))[0].insertId;

    ids.oA = (await db.insert(oportunidades).values({ empresaId: ids.empA, titulo: `Proyecto ${M} uno`, etapaId: etapa!.id, responsableId: aId }))[0].insertId;
    ids.oB = (await db.insert(oportunidades).values({ empresaId: ids.empB, titulo: `Proyecto ${M} dos`, etapaId: etapa!.id, responsableId: bId }))[0].insertId;

    const cotizacion = async (oportunidadId: number, empresaId: number, estado: "enviada" | "obsoleta") =>
      (await db.insert(cotizaciones).values({ empresaId, oportunidadId, subtotal: "100.00", total: "116.00", fechaEmision: "2026-10-21", estado, creadoPor: adminId }))[0].insertId;
    ids.qA = await cotizacion(ids.oA, ids.empA, "enviada");
    ids.qObsoleta = await cotizacion(ids.oA, ids.empA, "obsoleta");
    ids.qB = await cotizacion(ids.oB, ids.empB, "enviada");

    const tarea = async (valores: typeof tareas.$inferInsert) => (await db.insert(tareas).values(valores))[0].insertId;
    ids.tA = await tarea({ titulo: `Llamar a ${M}`, responsableId: aId, empresaId: ids.empA });
    ids.tOtraEnEmpA = await tarea({ titulo: `Visitar ${M}`, responsableId: bId, empresaId: ids.empA });
    ids.tCerrada = await tarea({ titulo: `Cerrada ${M}`, responsableId: aId, empresaId: ids.empA, estado: "cerrada" });
    ids.tCancelada = await tarea({ titulo: `Cancelada ${M}`, responsableId: aId, empresaId: ids.empA, estado: "cancelada" });

    for (let i = 1; i <= 7; i++) await empresa({ nombreLegal: `${M2} ${i}` });
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("sin sesión: 401", async () => {
    expect((await api().get("/api/v1/buscar").query({ q: M })).status).toBe(401);
  });

  it("texto vacío o grupo desconocido: 400", async () => {
    expect((await api().get("/api/v1/buscar").query({ q: "  " }).set("Cookie", admin)).status).toBe(400);
    expect((await api().get("/api/v1/buscar").set("Cookie", admin)).status).toBe(400);
    expect((await api().get("/api/v1/buscar").query({ q: M, grupo: "documentos" }).set("Cookie", admin)).status).toBe(400);
  });

  it("desde 1 letra regresa los 6 grupos, 5 como máximo cada uno", async () => {
    const r = await buscar(admin, "a");
    for (const grupo of GRUPOS) {
      expect(r[grupo].data.length).toBeLessThanOrEqual(5);
      expect(typeof r[grupo].hay_mas).toBe("boolean");
    }
  });

  it("admin encuentra lo de todos, sin inactivos, obsoletas ni tareas cerradas", async () => {
    const r = await buscar(admin, M);
    expect(idsDe(r, "empresas")).toEqual(expect.arrayContaining([ids.empA, ids.empB]));
    expect(idsDe(r, "empresas")).not.toContain(ids.empInactiva);
    expect(idsDe(r, "contactos").sort()).toEqual([ids.cA, ids.cB].sort());
    expect(idsDe(r, "prospectos").sort()).toEqual([ids.pA, ids.pB].sort());
    expect(idsDe(r, "oportunidades").sort()).toEqual([ids.oA, ids.oB].sort());
    expect(idsDe(r, "cotizaciones").sort()).toEqual([ids.qA, ids.qB].sort());
    expect(idsDe(r, "tareas").sort()).toEqual([ids.tA, ids.tOtraEnEmpA].sort());
  });

  it("cada fila trae título, detalle y la empresa para armar la liga", async () => {
    const r = await buscar(admin, `La Casa del ${M}`);
    expect(r.empresas.data[0]).toMatchObject({ id: ids.empA, titulo: `La Casa del ${M}`, empresa_id: ids.empA });
    expect(r.oportunidades.data[0]).toMatchObject({ id: ids.oA, titulo: `Proyecto ${M} uno`, empresa_id: ids.empA, detalle: expect.stringContaining(`La Casa del ${M}`) });
    expect(r.cotizaciones.data[0]).toMatchObject({ id: ids.qA, titulo: `Cotización #${ids.qA}`, empresa_id: ids.empA });
  });

  it("contacto y prospecto se encuentran por correo y por teléfono", async () => {
    for (const q of [`ana.${m}@`, D, `477 ${D}`]) {
      const r = await buscar(admin, q);
      expect(idsDe(r, "contactos")).toEqual([ids.cA]);
      expect(idsDe(r, "prospectos")).toEqual([ids.pA]);
    }
  });

  it("por empresa: oportunidades, cotizaciones y tareas de esa empresa", async () => {
    const r = await buscar(admin, `La Casa del ${M}`);
    expect(idsDe(r, "empresas")).toEqual([ids.empA]);
    expect(idsDe(r, "prospectos")).toEqual([ids.pA]);
    expect(idsDe(r, "oportunidades")).toEqual([ids.oA]);
    expect(idsDe(r, "cotizaciones")).toEqual([ids.qA]);
    expect(idsDe(r, "tareas").sort()).toEqual([ids.tA, ids.tOtraEnEmpA].sort());
  });

  it("cotización por folio, con o sin #", async () => {
    expect(idsDe(await buscar(admin, `#${ids.qA}`), "cotizaciones")).toContain(ids.qA);
    expect(idsDe(await buscar(admin, String(ids.qA)), "cotizaciones")).toContain(ids.qA);
  });

  it("empresas no se buscan por giro", async () => {
    expect((await buscar(admin, `Giro${M}x`)).empresas.data).toEqual([]);
  });

  it("agente: solo lo suyo, ni la tarea de otro en una empresa suya", async () => {
    const r = await buscar(agenteA, M);
    expect(idsDe(r, "empresas")).toEqual([ids.empA]);
    expect(idsDe(r, "contactos")).toEqual([ids.cA]);
    expect(idsDe(r, "prospectos")).toEqual([ids.pA]);
    expect(idsDe(r, "oportunidades")).toEqual([ids.oA]);
    expect(idsDe(r, "cotizaciones")).toEqual([ids.qA]);
    expect(idsDe(r, "tareas")).toEqual([ids.tA]);

    const b = await buscar(agenteB, M);
    expect(idsDe(b, "empresas")).toEqual([ids.empB]);
    expect(idsDe(b, "tareas")).toEqual([ids.tOtraEnEmpA]);
    expect(idsDe(b, "cotizaciones")).toEqual([ids.qB]);
  });

  it("supervisor ve lo de todos", async () => {
    const r = await buscar(supervisor, M);
    expect(idsDe(r, "empresas")).toEqual(expect.arrayContaining([ids.empA, ids.empB]));
    expect(idsDe(r, "tareas").sort()).toEqual([ids.tA, ids.tOtraEnEmpA].sort());
  });

  it("lo que empieza con el texto sale primero", async () => {
    const r = await buscar(admin, M);
    expect(r.empresas.data[0]!.id).toBe(ids.empB);
  });

  it("5 por grupo y 'Ver más' trae los siguientes de ese grupo", async () => {
    const r = await buscar(admin, M2);
    expect(r.empresas.data).toHaveLength(5);
    expect(r.empresas.hay_mas).toBe(true);

    const mas = await buscar(admin, M2, { grupo: "empresas", desde: 5 });
    expect(Object.keys(mas)).toEqual(["empresas"]);
    expect(mas.empresas.data).toHaveLength(2);
    expect(mas.empresas.hay_mas).toBe(false);
    expect(new Set([...idsDe(r, "empresas"), ...idsDe(mas, "empresas")]).size).toBe(7);
  });

  it("% y _ se buscan tal cual, no como comodines", async () => {
    const r = await buscar(admin, `${M}_Distribuidora`);
    expect(r.empresas.data).toEqual([]);
  });
});
