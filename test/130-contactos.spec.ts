import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

describe("/contactos (vista plana)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agente1Cookie: string[];
  let agente2Cookie: string[];
  const sufijo = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agente1Cookie = await crearAgente(app, adminCookie, `contactos.agente1.${sufijo}@test.local`);
    agente2Cookie = await crearAgente(app, adminCookie, `contactos.agente2.${sufijo}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function crearEmpresa(cookie: string[], nombreLegal: string, contacto: Record<string, unknown>) {
    const res = await request(app.getHttpServer()).post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal, contactos: [contacto] });
    expect(res.status).toBe(201);
    const detalle = await request(app.getHttpServer()).get(`/api/v1/empresas/${res.body.id}`).set("Cookie", cookie);
    return { empresaId: res.body.id as number, contactoId: detalle.body.contactos[0].id as number };
  }

  it("crear, leer, editar y desactivar un contacto sin pasar por la ruta anidada", async () => {
    const { empresaId } = await crearEmpresa(adminCookie, `Empresa Contactos Flujo ${sufijo}`, { nombre: "Primer Contacto", correo: `primero.${sufijo}@test.local` });

    const crear = await request(app.getHttpServer())
      .post("/api/v1/contactos")
      .set("Cookie", adminCookie)
      .send({ empresaId, nombre: "Segundo Contacto", puesto: "Compras", correo: `segundo.${sufijo}@test.local`, telefono: "5555550001" });
    expect(crear.status).toBe(201);
    const id = crear.body.id;

    const detalle = await request(app.getHttpServer()).get(`/api/v1/contactos/${id}`).set("Cookie", adminCookie);
    expect(detalle.status).toBe(200);
    expect(detalle.body).toMatchObject({ id, empresa_id: empresaId, empresa_nombre: `Empresa Contactos Flujo ${sufijo}`, nombre: "Segundo Contacto", puesto: "Compras" });
    expect(detalle.body.medios.map((m: { tipo: string }) => m.tipo).sort()).toEqual(["correo", "telefono"]);

    const editar = await request(app.getHttpServer()).patch(`/api/v1/contactos/${id}`).set("Cookie", adminCookie).send({ puesto: "Dirección", telefono: null });
    expect(editar.status).toBe(200);
    expect(editar.body.puesto).toBe("Dirección");
    expect(editar.body.medios.find((m: { tipo: string }) => m.tipo === "telefono").estado_contacto).toBe("obsoleto");

    const borrar = await request(app.getHttpServer()).delete(`/api/v1/contactos/${id}`).set("Cookie", adminCookie);
    expect(borrar.status).toBe(204);

    const despues = await request(app.getHttpServer()).get(`/api/v1/contactos/${id}`).set("Cookie", adminCookie);
    expect(despues.status).toBe(404);
  });

  it("el listado pagina por contacto (no por medio), filtra por empresa y por nombre", async () => {
    const { empresaId } = await crearEmpresa(adminCookie, `Empresa Listado ${sufijo}`, { nombre: "Ana Listado", correo: `ana.${sufijo}@test.local`, telefono: "5555550002" });
    await request(app.getHttpServer()).post("/api/v1/contactos").set("Cookie", adminCookie).send({ empresaId, nombre: "Beto Listado", correo: `beto.${sufijo}@test.local` });

    const pagina1 = await request(app.getHttpServer()).get(`/api/v1/contactos?empresaId=${empresaId}&limit=1`).set("Cookie", adminCookie);
    expect(pagina1.status).toBe(200);
    expect(pagina1.body.data).toHaveLength(1);
    // Ana tiene 2 medios: si se paginara por fila-de-medio, esta página
    // traería un solo medio y no el contacto completo.
    expect(pagina1.body.data[0].nombre).toBe("Ana Listado");
    expect(pagina1.body.data[0].medios).toHaveLength(2);

    const pagina2 = await request(app.getHttpServer()).get(`/api/v1/contactos?empresaId=${empresaId}&limit=1&page=2`).set("Cookie", adminCookie);
    expect(pagina2.body.data.map((c: { nombre: string }) => c.nombre)).toEqual(["Beto Listado"]);

    const porNombre = await request(app.getHttpServer()).get(`/api/v1/contactos?empresaId=${empresaId}&q=beto`).set("Cookie", adminCookie);
    expect(porNombre.body.data.map((c: { nombre: string }) => c.nombre)).toEqual(["Beto Listado"]);

    // Un "%" en la búsqueda es texto literal, no comodín.
    const comodin = await request(app.getHttpServer()).get(`/api/v1/contactos?empresaId=${empresaId}&q=%25`).set("Cookie", adminCookie);
    expect(comodin.body.data).toHaveLength(0);
  });

  it("un agente solo ve, edita y borra contactos de sus propias empresas; lo ajeno responde 404", async () => {
    const { empresaId, contactoId } = await crearEmpresa(agente1Cookie, `Empresa Agente 1 Contactos ${sufijo}`, { nombre: "Contacto Agente 1", correo: `agente1.contacto.${sufijo}@test.local` });

    const propio = await request(app.getHttpServer()).get(`/api/v1/contactos/${contactoId}`).set("Cookie", agente1Cookie);
    expect(propio.status).toBe(200);

    const ajenoGet = await request(app.getHttpServer()).get(`/api/v1/contactos/${contactoId}`).set("Cookie", agente2Cookie);
    expect(ajenoGet.status).toBe(404);
    const ajenoPatch = await request(app.getHttpServer()).patch(`/api/v1/contactos/${contactoId}`).set("Cookie", agente2Cookie).send({ puesto: "X" });
    expect(ajenoPatch.status).toBe(404);
    const ajenoDelete = await request(app.getHttpServer()).delete(`/api/v1/contactos/${contactoId}`).set("Cookie", agente2Cookie);
    expect(ajenoDelete.status).toBe(404);
    const ajenoPost = await request(app.getHttpServer()).post("/api/v1/contactos").set("Cookie", agente2Cookie).send({ empresaId, nombre: "Intruso", correo: `intruso.${sufijo}@test.local` });
    expect(ajenoPost.status).toBe(404);

    const listaAjena = await request(app.getHttpServer()).get(`/api/v1/contactos?empresaId=${empresaId}`).set("Cookie", agente2Cookie);
    expect(listaAjena.body.data).toHaveLength(0);
    const listaPropia = await request(app.getHttpServer()).get(`/api/v1/contactos?empresaId=${empresaId}`).set("Cookie", agente1Cookie);
    expect(listaPropia.body.data).toHaveLength(1);
  });

  it("un contacto de una empresa desactivada deja de aparecer", async () => {
    const { empresaId, contactoId } = await crearEmpresa(adminCookie, `Empresa Desactivada Contactos ${sufijo}`, { nombre: "Contacto Huérfano", correo: `huerfano.${sufijo}@test.local` });
    await request(app.getHttpServer()).delete(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);

    const res = await request(app.getHttpServer()).get(`/api/v1/contactos/${contactoId}`).set("Cookie", adminCookie);
    expect(res.status).toBe(404);
  });

  it("valida el cuerpo: empresaId obligatorio, al menos un medio de contacto, y correo duplicado responde 409", async () => {
    const correo = `dup.${sufijo}@test.local`;
    const { empresaId } = await crearEmpresa(adminCookie, `Empresa Validaciones Contactos ${sufijo}`, { nombre: "Contacto Base", correo });

    const sinEmpresa = await request(app.getHttpServer()).post("/api/v1/contactos").set("Cookie", adminCookie).send({ nombre: "Sin Empresa", correo: `sinempresa.${sufijo}@test.local` });
    expect(sinEmpresa.status).toBe(400);

    const sinMedio = await request(app.getHttpServer()).post("/api/v1/contactos").set("Cookie", adminCookie).send({ empresaId, nombre: "Sin Medio" });
    expect(sinMedio.status).toBe(400);

    const duplicado = await request(app.getHttpServer()).post("/api/v1/contactos").set("Cookie", adminCookie).send({ empresaId, nombre: "Duplicado", correo });
    expect(duplicado.status).toBe(409);
  });

  it("sin sesión responde 401", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/contactos");
    expect(res.status).toBe(401);
  });
});
