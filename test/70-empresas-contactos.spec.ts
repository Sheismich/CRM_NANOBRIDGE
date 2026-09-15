import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, mediosContacto } from "../src/database/schema.js";

describe("empresas + contactos", () => {
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

  it("un agente no puede ver una empresa de otro agente (404), pero sí la suya; administrador ve cualquiera", async () => {
    const agente1Cookie = await crearAgente(app, adminCookie, `agente1.${Date.now()}@test.local`);
    const agente2Cookie = await crearAgente(app, adminCookie, `agente2.${Date.now()}@test.local`);

    const crear = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", agente1Cookie)
      .send({ nombreLegal: "Empresa De Agente 1", contactos: [{ nombre: "Contacto 1", correo: `contacto1.${Date.now()}@test.local` }] });
    expect(crear.status).toBe(201);
    const empresaId = crear.body.id;

    const propia = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", agente1Cookie);
    expect(propia.status).toBe(200);

    const ajena = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", agente2Cookie);
    expect(ajena.status).toBe(404);

    const comoAdmin = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    expect(comoAdmin.status).toBe(200);
  });

  it("desactivar una empresa (solo administrador/supervisor) desactiva en cascada sus contactos y marca sus medios como obsoletos", async () => {
    const crear = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa A Desactivar", contactos: [{ nombre: "Contacto A Desactivar", correo: `desactivar.${Date.now()}@test.local` }] });
    expect(crear.status).toBe(201);
    const empresaId = crear.body.id;

    const antes = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    const contactoId = antes.body.contactos[0].id;

    const desactivar = await request(app.getHttpServer()).delete(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    expect(desactivar.status).toBe(204);

    // get()/list() filtran por activo=true -- una empresa desactivada ya no
    // se ve como si existiera.
    const despues = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    expect(despues.status).toBe(404);

    const [contactoRow] = await db.select().from(contactos).where(eq(contactos.id, contactoId));
    expect(contactoRow.activo).toBe(false);

    const medios = await db.select().from(mediosContacto).where(eq(mediosContacto.contactoId, contactoId));
    expect(medios.length).toBeGreaterThan(0);
    for (const medio of medios) expect(medio.estadoContacto).toBe("obsoleto");
  });

  it("un medio de contacto en no_contactar no se reactiva solo porque un PATCH reenvía el mismo valor", async () => {
    const correo = `no.contactar.${Date.now()}@test.local`;
    // Se le da también teléfono: si el contacto solo tuviera el correo, al
    // preservar no_contactar (lo que esta prueba cubre) se quedaría sin
    // NINGÚN medio activo, y esa OTRA regla ("el contacto debe conservar
    // al menos un medio activo") bloquearía el PATCH por una razón
    // distinta a la que aquí se quiere probar.
    const crear = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa No Contactar", contactos: [{ nombre: "Contacto No Contactar", correo, telefono: "5555551234" }] });
    expect(crear.status).toBe(201);
    const empresaId = crear.body.id;

    const detalle = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    const contactoId = detalle.body.contactos[0].id;

    // Simula que el correo ya fue marcado no_contactar (ej. por una baja
    // registrada desde n8n) -- llegar a ese estado por el flujo completo de
    // automatización no es lo que esta prueba busca cubrir, solo que un
    // PATCH normal del CRM no lo revierta sin querer.
    await db.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.tipo, "correo")));

    const patch = await request(app.getHttpServer())
      .patch(`/api/v1/empresas/${empresaId}/contactos/${contactoId}`)
      .set("Cookie", adminCookie)
      .send({ correo }); // mismo valor, sin cambios reales
    expect(patch.status).toBe(200);

    const [medio] = await db.select().from(mediosContacto).where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.tipo, "correo")));
    expect(medio.estadoContacto).toBe("no_contactar");
  });

  it("dos contactos con el mismo correo (en cualquier empresa) responden 409, no un choque silencioso", async () => {
    const correoCompartido = `duplicado.${Date.now()}@test.local`;
    const crear = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Original Duplicado", contactos: [{ nombre: "Contacto Original", correo: correoCompartido }] });
    expect(crear.status).toBe(201);

    const segunda = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Nueva Duplicado", contactos: [{ nombre: "Otro Contacto", correo: correoCompartido }] });
    expect(segunda.status).toBe(409);
  });
});
