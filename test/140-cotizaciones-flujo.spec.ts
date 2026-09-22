import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria } from "../src/database/schema.js";

// Transiciones de estado, versionado, scoping y reglas de negocio de
// cotizaciones. 30-cotizaciones-rounding.spec.ts ya cubre solo el redondeo
// de montos.
describe("cotizaciones: estados, versionado y scoping", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;
  let contactoId: number;
  const sufijo = Date.now();
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    ({ empresaId, contactoId } = await crearEmpresa(adminCookie, `Empresa Cotizaciones ${sufijo}`, `cotizaciones.${sufijo}@test.local`));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function crearEmpresa(cookie: string[], nombreLegal: string, correo: string) {
    const res = await request(app.getHttpServer()).post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal, contactos: [{ nombre: "Contacto Cotizaciones", correo }] });
    expect(res.status).toBe(201);
    const detalle = await request(app.getHttpServer()).get(`/api/v1/empresas/${res.body.id}`).set("Cookie", cookie);
    return { empresaId: res.body.id as number, contactoId: detalle.body.contactos[0].id as number };
  }

  async function crearOportunidad(cookie: string[], empresa = empresaId) {
    const res = await request(app.getHttpServer()).post("/api/v1/oportunidades").set("Cookie", cookie).send({ empresaId: empresa, titulo: `Oportunidad ${Math.random()}` });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  const partidas = [{ descripcion: "Servicio de prueba", cantidad: 2, precioUnitario: 100 }];

  async function crearCotizacion(cookie: string[], oportunidadId: number, extra: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", cookie).send({ empresaId, oportunidadId, partidas, ...extra });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function cambiarEstado(cookie: string[], id: number, estado: string) {
    return request(app.getHttpServer()).patch(`/api/v1/cotizaciones/${id}/estado`).set("Cookie", cookie).send({ estado });
  }

  function nuevaVersion(cookie: string[], id: number, body: Record<string, unknown> = { partidas }) {
    return request(app.getHttpServer()).post(`/api/v1/cotizaciones/${id}/version`).set("Cookie", cookie).send(body);
  }

  async function detalle(cookie: string[], id: number) {
    const res = await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body;
  }

  describe("transiciones de estado", () => {
    it("borrador → enviada (fija fecha_envio) → aceptada, y deja rastro en auditoría", async () => {
      const id = await crearCotizacion(adminCookie, await crearOportunidad(adminCookie));
      expect((await detalle(adminCookie, id)).estado).toBe("borrador");
      expect((await detalle(adminCookie, id)).fecha_envio).toBeNull();

      const enviada = await cambiarEstado(adminCookie, id, "enviada");
      expect(enviada.status).toBe(200);
      expect(enviada.body.estado).toBe("enviada");
      expect(enviada.body.fecha_envio).not.toBeNull();

      const aceptada = await cambiarEstado(adminCookie, id, "aceptada");
      expect(aceptada.status).toBe(200);
      expect(aceptada.body.estado).toBe("aceptada");

      const filas = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "cotizacion"), eq(auditoria.entidadId, id), eq(auditoria.accion, "cambiar_estado")));
      expect(filas.map((f) => [(f.antes as { estado: string }).estado, (f.despues as { estado: string }).estado])).toEqual([
        ["borrador", "enviada"],
        ["enviada", "aceptada"]
      ]);
    });

    it("rechaza saltos inválidos con 409, y los estados terminales no se mueven", async () => {
      const id = await crearCotizacion(adminCookie, await crearOportunidad(adminCookie));

      // borrador solo puede ir a enviada.
      expect((await cambiarEstado(adminCookie, id, "aceptada")).status).toBe(409);
      expect((await cambiarEstado(adminCookie, id, "rechazada")).status).toBe(409);
      expect((await cambiarEstado(adminCookie, id, "vencida")).status).toBe(409);

      await cambiarEstado(adminCookie, id, "enviada");
      await cambiarEstado(adminCookie, id, "rechazada");

      // rechazada es terminal.
      for (const estado of ["enviada", "aceptada", "vencida"]) {
        expect((await cambiarEstado(adminCookie, id, estado)).status).toBe(409);
      }
      expect((await detalle(adminCookie, id)).estado).toBe("rechazada");
    });

    it("'obsoleta' nunca es un destino manual (solo lo fija nuevaVersion) y un estado desconocido es 400", async () => {
      const id = await crearCotizacion(adminCookie, await crearOportunidad(adminCookie));
      expect((await cambiarEstado(adminCookie, id, "obsoleta")).status).toBe(400);
      expect((await cambiarEstado(adminCookie, id, "inventado")).status).toBe(400);
    });

    it("dos cambios de estado simultáneos sobre la misma cotización: solo uno gana", async () => {
      const id = await crearCotizacion(adminCookie, await crearOportunidad(adminCookie));
      await cambiarEstado(adminCookie, id, "enviada");

      const [a, b] = await Promise.all([cambiarEstado(adminCookie, id, "aceptada"), cambiarEstado(adminCookie, id, "rechazada")]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const final = (await detalle(adminCookie, id)).estado;
      expect(final).toBe(a.status === 200 ? "aceptada" : "rechazada");
    });
  });

  describe("versionado", () => {
    it("una nueva versión deja la anterior obsoleta, conserva la raíz y hereda lo que no se manda", async () => {
      const oportunidadId = await crearOportunidad(adminCookie);
      const v1 = await crearCotizacion(adminCookie, oportunidadId, { contactoId, probabilidad: 40, fechaEsperadaCierre: "2027-03-15" });

      const res2 = await nuevaVersion(adminCookie, v1, { partidas: [{ descripcion: "Alcance ampliado", cantidad: 1, precioUnitario: 500 }] });
      expect(res2.status).toBe(201);
      expect(res2.body.version).toBe(2);
      const v2 = res2.body.id as number;

      expect((await detalle(adminCookie, v1)).estado).toBe("obsoleta");

      const d2 = await detalle(adminCookie, v2);
      expect(d2.estado).toBe("borrador");
      expect(d2.version).toBe(2);
      expect(d2.cotizacion_raiz_id).toBe(v1);
      expect(d2.contacto_id).toBe(contactoId);
      expect(d2.probabilidad).toBe(40);
      expect(String(d2.fecha_esperada_cierre)).toContain("2027-03-15");
      expect(d2.total).toBe("500.00");
      expect(d2.partidas).toHaveLength(1);

      // Una tercera versión sigue colgando de la MISMA raíz, no de v2.
      const res3 = await nuevaVersion(adminCookie, v2, { partidas, probabilidad: 70 });
      expect(res3.status).toBe(201);
      const d3 = await detalle(adminCookie, res3.body.id);
      expect(d3.version).toBe(3);
      expect(d3.cotizacion_raiz_id).toBe(v1);
      expect(d3.probabilidad).toBe(70);
      expect(d3.versiones.map((v: { version: number; estado: string }) => [v.version, v.estado])).toEqual([
        [1, "obsoleta"],
        [2, "obsoleta"],
        [3, "borrador"]
      ]);
    });

    it("una cotización obsoleta no se puede versionar ni cambiar de estado", async () => {
      const v1 = await crearCotizacion(adminCookie, await crearOportunidad(adminCookie));
      expect((await nuevaVersion(adminCookie, v1)).status).toBe(201);

      expect((await nuevaVersion(adminCookie, v1)).status).toBe(409);
      expect((await cambiarEstado(adminCookie, v1, "enviada")).status).toBe(409);
    });

    it("una cotización ya enviada sí se puede versionar (no se edita en sitio)", async () => {
      const v1 = await crearCotizacion(adminCookie, await crearOportunidad(adminCookie));
      await cambiarEstado(adminCookie, v1, "enviada");

      const res = await nuevaVersion(adminCookie, v1);
      expect(res.status).toBe(201);
      expect((await detalle(adminCookie, v1)).estado).toBe("obsoleta");
      expect((await detalle(adminCookie, res.body.id)).estado).toBe("borrador");
    });

    it("dos versiones simultáneas de la misma cotización: solo una gana, no quedan dos vigentes", async () => {
      const oportunidadId = await crearOportunidad(adminCookie);
      const v1 = await crearCotizacion(adminCookie, oportunidadId);

      const [a, b] = await Promise.all([nuevaVersion(adminCookie, v1), nuevaVersion(adminCookie, v1)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);

      const lista = await request(app.getHttpServer()).get(`/api/v1/cotizaciones?empresaId=${empresaId}&oportunidadId=${oportunidadId}`).set("Cookie", adminCookie);
      expect(lista.body.data).toHaveLength(1);
      expect(lista.body.data[0].version).toBe(2);
    });

    it("el listado solo muestra la versión vigente de cada cadena", async () => {
      const oportunidadId = await crearOportunidad(adminCookie);
      const v1 = await crearCotizacion(adminCookie, oportunidadId);
      const { body } = await nuevaVersion(adminCookie, v1);

      const lista = await request(app.getHttpServer()).get(`/api/v1/cotizaciones?empresaId=${empresaId}&oportunidadId=${oportunidadId}`).set("Cookie", adminCookie);
      expect(lista.status).toBe(200);
      expect(lista.body.data.map((c: { id: number }) => c.id)).toEqual([body.id]);
    });
  });

  describe("scoping por agente", () => {
    it("un agente solo ve, versiona y cambia de estado las cotizaciones de SUS oportunidades", async () => {
      const agente1 = await crearAgente(app, adminCookie, `cot.agente1.${sufijo}@test.local`);
      const agente2 = await crearAgente(app, adminCookie, `cot.agente2.${sufijo}@test.local`);
      const oportunidadId = await crearOportunidad(agente1);
      const id = await crearCotizacion(agente1, oportunidadId);

      expect((await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${id}`).set("Cookie", agente1)).status).toBe(200);

      expect((await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${id}`).set("Cookie", agente2)).status).toBe(404);
      expect((await nuevaVersion(agente2, id)).status).toBe(404);
      expect((await cambiarEstado(agente2, id, "enviada")).status).toBe(404);
      // Tampoco puede colgar una cotización nueva de la oportunidad de otro.
      const ajena = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", agente2).send({ empresaId, oportunidadId, partidas });
      expect(ajena.status).toBe(404);

      const listaAjena = await request(app.getHttpServer()).get(`/api/v1/cotizaciones?empresaId=${empresaId}&oportunidadId=${oportunidadId}`).set("Cookie", agente2);
      expect(listaAjena.body.data).toHaveLength(0);
      const listaPropia = await request(app.getHttpServer()).get(`/api/v1/cotizaciones?empresaId=${empresaId}&oportunidadId=${oportunidadId}`).set("Cookie", agente1);
      expect(listaPropia.body.data).toHaveLength(1);

      // Administrador ve cualquiera.
      expect((await request(app.getHttpServer()).get(`/api/v1/cotizaciones/${id}`).set("Cookie", adminCookie)).status).toBe(200);
    });
  });

  describe("reglas de negocio al crear", () => {
    it("no se cotiza contra una oportunidad ya cerrada (409)", async () => {
      const oportunidadId = await crearOportunidad(adminCookie);
      const cierre = await request(app.getHttpServer()).patch(`/api/v1/oportunidades/${oportunidadId}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" });
      expect(cierre.status).toBe(200);

      const res = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, partidas });
      expect(res.status).toBe(409);
    });

    it("no se cotiza contra una empresa desactivada (404)", async () => {
      const otra = await crearEmpresa(adminCookie, `Empresa Cotizacion Baja ${sufijo}`, `cotizacion.baja.${sufijo}@test.local`);
      const oportunidadId = await crearOportunidad(adminCookie, otra.empresaId);
      await request(app.getHttpServer()).delete(`/api/v1/empresas/${otra.empresaId}`).set("Cookie", adminCookie);

      const res = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId: otra.empresaId, oportunidadId, partidas });
      expect(res.status).toBe(404);
    });

    it("la oportunidad y el contacto tienen que pertenecer a la empresa indicada (404)", async () => {
      const otra = await crearEmpresa(adminCookie, `Empresa Cotizacion Otra ${sufijo}`, `cotizacion.otra.${sufijo}@test.local`);
      const oportunidadDeOtra = await crearOportunidad(adminCookie, otra.empresaId);
      const oportunidadPropia = await crearOportunidad(adminCookie);

      const oportunidadAjena = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId: oportunidadDeOtra, partidas });
      expect(oportunidadAjena.status).toBe(404);

      const contactoAjeno = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId: oportunidadPropia, contactoId: otra.contactoId, partidas });
      expect(contactoAjeno.status).toBe(404);

      const oportunidadInexistente = await request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId: 999999, partidas });
      expect(oportunidadInexistente.status).toBe(404);
    });
  });

  describe("validación de montos y entrada", () => {
    it("rechaza montos incoherentes con 400", async () => {
      const oportunidadId = await crearOportunidad(adminCookie);
      const enviar = (body: Record<string, unknown>) => request(app.getHttpServer()).post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, ...body });

      // Descuento mayor que subtotal + impuestos -> total negativo.
      expect((await enviar({ partidas, descuento: 1000 })).status).toBe(400);
      // Sin partidas.
      expect((await enviar({ partidas: [] })).status).toBe(400);
      // Cantidad cero / precio negativo.
      expect((await enviar({ partidas: [{ descripcion: "Cero", cantidad: 0, precioUnitario: 10 }] })).status).toBe(400);
      expect((await enviar({ partidas: [{ descripcion: "Negativo", cantidad: 1, precioUnitario: -1 }] })).status).toBe(400);
      // Desborda DECIMAL(12,2).
      expect((await enviar({ partidas: [{ descripcion: "Enorme", cantidad: 1_000_000, precioUnitario: 100_000_000 }] })).status).toBe(400);
      // Fecha que no es fecha, probabilidad fuera de rango.
      expect((await enviar({ partidas, fechaEsperadaCierre: "mañana" })).status).toBe(400);
      expect((await enviar({ partidas, probabilidad: 150 })).status).toBe(400);
    });

    it("sin sesión responde 401", async () => {
      expect((await request(app.getHttpServer()).get(`/api/v1/cotizaciones?empresaId=${empresaId}`)).status).toBe(401);
      expect((await request(app.getHttpServer()).post("/api/v1/cotizaciones").send({})).status).toBe(401);
    });
  });
});
