import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { contactos, empresas, prospectos } from "../src/database/schema.js";

// Nuevo prospecto en una empresa que ya existe (Fabián, 22-oct-2026): antes
// el alta manual siempre creaba otra empresa, aunque se llamara igual (el
// nombre nunca junta registros). Ahora se elige la empresa y el contacto
// nuevo se cuelga de ella.
describe("POST /prospectos con empresaId (empresa que ya existe)", () => {
  let app: INestApplication;
  let admin: string[];
  let agente: string[];
  let otroAgente: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    agente = await crearAgente(app, admin, `existente.agente.${randomUUID()}@test.local`);
    otroAgente = await crearAgente(app, admin, `existente.otro.${randomUUID()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    // La conexión a la base la cierra el segundo describe (corren en orden).
  });

  async function crearEmpresa(cookie: string[]) {
    const nombreLegal = `Existente ${randomUUID().slice(0, 8)}`;
    const res = await api().post("/api/v1/empresas").set("Cookie", cookie).send({
      nombreLegal,
      giro: "Manufactura",
      tamano: "mediana",
      contactos: [{ nombre: "Primer Contacto", correo: `primero.${randomUUID()}@test.local` }]
    });
    expect(res.status).toBe(201);
    return { id: res.body.id as number, nombreLegal };
  }

  const prospecto = (empresaId: number) => ({ empresaId, contactoNombre: "Laura Gómez", correo: `laura.${randomUUID()}@test.local`, canalInicial: "correo" });

  async function confirmar(cookie: string[], borrador: { lote_id: string; id: number }) {
    return api().post(`/api/v1/prospectos/importaciones/${borrador.lote_id}/filas/${borrador.id}/confirmar`).set("Cookie", cookie).send({ usarContactoExistente: false });
  }

  it("cuelga el contacto nuevo de esa empresa, sin crear otra con el mismo nombre", async () => {
    const empresa = await crearEmpresa(admin);
    const alta = await api().post("/api/v1/prospectos").set("Cookie", admin).send(prospecto(empresa.id));
    expect(alta.status).toBe(201);
    expect(alta.body).toEqual(expect.objectContaining({ estado: "pendiente_revision", empresa_nombre_legal: empresa.nombreLegal }));

    const res = await confirmar(admin, alta.body);
    expect(res.status).toBe(200);
    expect(res.body.empresa_id).toBe(empresa.id);
    const [contacto] = await db.select({ empresaId: contactos.empresaId }).from(contactos).where(eq(contactos.id, res.body.contacto_id));
    expect(contacto!.empresaId).toBe(empresa.id);
    expect(await db.select({ id: empresas.id }).from(empresas).where(eq(empresas.nombreLegal, empresa.nombreLegal))).toHaveLength(1);
  });

  it("GET /empresas trae el tamaño (la pantalla avisa si falta giro o tamaño)", async () => {
    const empresa = await crearEmpresa(admin);
    const res = await api().get("/api/v1/empresas").set("Cookie", admin).query({ q: empresa.nombreLegal });
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toEqual(expect.objectContaining({ id: empresa.id, giro: "Manufactura", tamano: "mediana" }));
  });

  it("sin empresaId ni nombre de empresa responde 400", async () => {
    const res = await api().post("/api/v1/prospectos").set("Cookie", admin).send({ contactoNombre: "Sin Empresa", correo: `sin.${randomUUID()}@test.local`, canalInicial: "correo" });
    expect(res.status).toBe(400);
  });

  it("una empresa que no existe responde 404", async () => {
    const res = await api().post("/api/v1/prospectos").set("Cookie", admin).send(prospecto(999_999_999));
    expect(res.status).toBe(404);
  });

  it("un agente solo puede usar sus empresas", async () => {
    const ajena = await crearEmpresa(otroAgente);
    expect((await api().post("/api/v1/prospectos").set("Cookie", agente).send(prospecto(ajena.id))).status).toBe(404);

    const suya = await crearEmpresa(agente);
    const alta = await api().post("/api/v1/prospectos").set("Cookie", agente).send(prospecto(suya.id));
    expect(alta.status).toBe(201);
    const res = await confirmar(agente, alta.body);
    expect(res.status).toBe(200);
    expect(res.body.empresa_id).toBe(suya.id);
  });

  it("una empresa desactivada no se puede usar (al capturar ni al confirmar)", async () => {
    const desactivada = await crearEmpresa(admin);
    await db.update(empresas).set({ activo: false }).where(eq(empresas.id, desactivada.id));
    expect((await api().post("/api/v1/prospectos").set("Cookie", admin).send(prospecto(desactivada.id))).status).toBe(409);

    // Se desactiva entre la captura y la confirmación.
    const empresa = await crearEmpresa(admin);
    const alta = await api().post("/api/v1/prospectos").set("Cookie", admin).send(prospecto(empresa.id));
    expect(alta.status).toBe(201);
    await db.update(empresas).set({ activo: false }).where(eq(empresas.id, empresa.id));
    expect((await confirmar(admin, alta.body)).status).toBe(409);
  });
});

// "Agregar a prospección" en la ficha de la empresa (22-oct-2026): un
// contacto que ya está en el CRM entra a Prospectos sin volver a capturarlo,
// y de ahí se puede mandar a automatización.
describe("POST /prospectos/desde-contacto", () => {
  let app: INestApplication;
  let admin: string[];
  let agente: string[];
  let otroAgente: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    agente = await crearAgente(app, admin, `desde.agente.${randomUUID()}@test.local`);
    otroAgente = await crearAgente(app, admin, `desde.otro.${randomUUID()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  // Empresa con un contacto; regresa el id de ese contacto.
  async function contactoDeEmpresaNueva(cookie: string[]) {
    const nombreLegal = `Desde Contacto ${randomUUID().slice(0, 8)}`;
    const res = await api().post("/api/v1/empresas").set("Cookie", cookie).send({
      nombreLegal,
      giro: "Manufactura",
      tamano: "mediana",
      contactos: [{ nombre: "Rosa Pérez", correo: `rosa.${randomUUID()}@test.local` }]
    });
    expect(res.status).toBe(201);
    const [contacto] = await db.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, res.body.id));
    return { contactoId: contacto!.id, empresaId: res.body.id as number, nombreLegal };
  }

  const agregar = (cookie: string[], contactoId: number) => api().post("/api/v1/prospectos/desde-contacto").set("Cookie", cookie).send({ contactoId });

  it("crea el prospecto 'capturado' de esa persona y sale en Prospectos", async () => {
    const c = await contactoDeEmpresaNueva(admin);
    const res = await agregar(admin, c.contactoId);
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ contacto_id: c.contactoId, empresa_id: c.empresaId }));
    const [p] = await db.select({ estado: prospectos.estado, contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, res.body.id));
    expect(p).toEqual({ estado: "capturado", contactoId: c.contactoId });
    const lista = await api().get("/api/v1/prospectos").set("Cookie", admin).query({ q: c.nombreLegal });
    expect(lista.body.data.map((f: { id: number }) => f.id)).toContain(res.body.id);
  });

  it("si la persona ya está en prospección responde 409 con el prospecto que tiene", async () => {
    const c = await contactoDeEmpresaNueva(admin);
    const primero = await agregar(admin, c.contactoId);
    const otra = await agregar(admin, c.contactoId);
    expect(otra.status).toBe(409);
    expect(otra.body.code).toBe("PROSPECTO_YA_ABIERTO");
    expect(otra.body.message).toContain(String(primero.body.id));

    // Cuando el anterior ya terminó (p. ej. no interesado) sí se puede.
    await db.update(prospectos).set({ estado: "no_interesado" }).where(eq(prospectos.id, primero.body.id));
    expect((await agregar(admin, c.contactoId)).status).toBe(201);
  });

  it("una persona dada de baja no vuelve a entrar", async () => {
    const c = await contactoDeEmpresaNueva(admin);
    const primero = await agregar(admin, c.contactoId);
    await db.update(prospectos).set({ estado: "baja" }).where(eq(prospectos.id, primero.body.id));
    const res = await agregar(admin, c.contactoId);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PERSONA_EN_BAJA");
  });

  it("un agente solo con contactos de sus empresas; un contacto desactivado no entra", async () => {
    const ajeno = await contactoDeEmpresaNueva(otroAgente);
    expect((await agregar(agente, ajeno.contactoId)).status).toBe(404);
    const suyo = await contactoDeEmpresaNueva(agente);
    expect((await agregar(agente, suyo.contactoId)).status).toBe(201);

    const desactivado = await contactoDeEmpresaNueva(admin);
    await db.update(contactos).set({ activo: false }).where(eq(contactos.id, desactivado.contactoId));
    expect((await agregar(admin, desactivado.contactoId)).status).toBe(409);
  });
});
