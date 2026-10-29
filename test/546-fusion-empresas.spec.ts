import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { auditoria, contactos, empresas, mediosContacto, oportunidades } from "../src/database/schema.js";

// Control G-05 (28-oct-2026): fusionar una empresa repetida (origen) en la que
// se queda (destino). Todo pasa a la destino, que completa los datos que le
// falten; la origen queda desactivada, con la fusión en la bitácora.
describe("fusionar empresas", () => {
  let app: INestApplication;
  let admin: string[];
  let agente: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const marca = () => randomUUID().slice(0, 8);

  async function empresa(cookie: string[], datos: Record<string, unknown>) {
    const res = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ contactos: [{ nombre: "Contacto", correo: `c.${randomUUID()}@cliente.test` }], ...datos });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }
  async function oportunidad(empresaId: number) {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", admin).send({ empresaId, titulo: `Oportunidad ${marca()}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }
  const fusionar = (cookie: string[], origen: number, body: Record<string, unknown>) => api().post(`/api/v1/empresas/${origen}/fusionar`).set("Cookie", cookie).send(body);
  const contactosDe = (empresaId: number) => db.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, empresaId)).then((r) => r.map((c) => c.id).sort());
  const fichaDe = (id: number) => db.select().from(empresas).where(eq(empresas.id, id)).then((r) => r[0]!);

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    agente = await crearAgente(app, admin, `agente.fusion.${randomUUID()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("simular dice qué se movería y qué se completaría, sin tocar nada", async () => {
    const m = marca();
    const origen = await empresa(admin, { nombreLegal: `Repetida ${m}`, giro: "Plásticos", ciudad: "León" });
    const destino = await empresa(admin, { nombreLegal: `Buena ${m}`, ciudad: "Aguascalientes" });
    await oportunidad(origen);

    const res = await fusionar(admin, origen, { destinoId: destino, simular: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ fusionada: false, origen: { id: origen, nombre: `Repetida ${m}` }, destino: { id: destino, nombre: `Buena ${m}` }, completar: ["giro"] }));
    expect(res.body.mover).toEqual(expect.objectContaining({ contactos: 1, oportunidades: 1 }));

    expect((await fichaDe(origen)).activo).toBe(true);
    expect((await fichaDe(destino)).giro).toBeNull();
    expect(await contactosDe(origen)).toHaveLength(1);
  });

  it("mueve contactos, medios y oportunidades; completa lo vacío sin pisar lo de la destino; desactiva la origen", async () => {
    const m = marca();
    const origen = await empresa(admin, { nombreLegal: `Origen ${m}`, giro: "Metalmecánica", ciudad: "León" });
    const destino = await empresa(admin, { nombreLegal: `Destino ${m}`, ciudad: "Aguascalientes" });
    const opp = await oportunidad(origen);
    const contactosAntes = [...(await contactosDe(origen)), ...(await contactosDe(destino))].sort();

    const res = await fusionar(admin, origen, { destinoId: destino });
    expect(res.status).toBe(200);
    expect(res.body.fusionada).toBe(true);

    expect(await contactosDe(origen)).toEqual([]);
    expect(await contactosDe(destino)).toEqual(contactosAntes);
    expect(await db.select().from(mediosContacto).where(eq(mediosContacto.empresaId, origen))).toEqual([]);
    expect((await db.select().from(oportunidades).where(eq(oportunidades.id, opp)))[0]!.empresaId).toBe(destino);

    const ficha = await fichaDe(destino);
    expect(ficha.giro).toBe("Metalmecánica");
    expect(ficha.ciudad).toBe("Aguascalientes");
    expect(ficha.activo).toBe(true);
    expect((await fichaDe(origen)).activo).toBe(false);

    const bitacora = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "empresa"), eq(auditoria.accion, "fusionar"), eq(auditoria.entidadId, origen)));
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]!.despues).toEqual(expect.objectContaining({ activo: false, fusionada_en: destino }));
    const recibida = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "empresa"), eq(auditoria.accion, "recibir_fusion"), eq(auditoria.entidadId, destino)));
    expect(recibida).toHaveLength(1);
  });

  it("una empresa ya fusionada (desactivada) no se vuelve a fusionar, ni sirve de destino", async () => {
    const m = marca();
    const origen = await empresa(admin, { nombreLegal: `Una ${m}` });
    const destino = await empresa(admin, { nombreLegal: `Dos ${m}` });
    const otra = await empresa(admin, { nombreLegal: `Tres ${m}` });
    expect((await fusionar(admin, origen, { destinoId: destino })).status).toBe(200);
    expect((await fusionar(admin, origen, { destinoId: otra })).status).toBe(404);
    expect((await fusionar(admin, otra, { destinoId: origen })).status).toBe(404);
  });

  it("no se fusiona consigo misma (400) ni con una que no existe (404)", async () => {
    const id = await empresa(admin, { nombreLegal: `Sola ${marca()}` });
    expect((await fusionar(admin, id, { destinoId: id })).status).toBe(400);
    expect((await fusionar(admin, id, { destinoId: 999_999_999 })).status).toBe(404);
    expect((await fusionar(admin, id, {})).status).toBe(400);
  });

  it("solo el administrador fusiona: un agente recibe 403 aunque las dos sean suyas", async () => {
    const m = marca();
    const origen = await empresa(agente, { nombreLegal: `Mía ${m}` });
    const destino = await empresa(agente, { nombreLegal: `También mía ${m}` });
    expect((await fusionar(agente, origen, { destinoId: destino, simular: true })).status).toBe(403);
    expect((await fichaDe(origen)).activo).toBe(true);
  });
});
