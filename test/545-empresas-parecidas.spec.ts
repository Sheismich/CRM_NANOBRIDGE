import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { normalizarNombreEmpresa } from "../src/shared/empresas-parecidas.js";

// Control G-01 (28-oct-2026): la base no deduplica empresas por nombre, así que
// al importar o dar de alta se avisa cuando ya hay una con el mismo nombre, y
// una fila importada se puede confirmar en esa empresa en vez de crear otra.
describe("empresas parecidas", () => {
  let app: INestApplication;
  let admin: string[];
  let agente: string[];
  let otroAgente: string[];
  const api = () => request(app.getHttpServer());
  const marca = () => randomUUID().slice(0, 8);

  async function empresa(cookie: string[], nombreLegal: string) {
    const res = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal, contactos: [{ nombre: "Contacto", correo: `c.${randomUUID()}@cliente.test` }] });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }
  const parecidas = (cookie: string[], nombre: string, excluir?: number) => api().get("/api/v1/empresas/parecidas").query({ nombre, ...(excluir ? { excluir } : {}) }).set("Cookie", cookie);
  const importar = (cookie: string[], filas: string[]) =>
    api().post("/api/v1/prospectos/importaciones").set("Cookie", cookie).attach("archivo", Buffer.from(["empresaNombreLegal,contactoNombre,correo,canalInicial", ...filas].join("\n")), "parecidas.csv");

  beforeAll(async () => {
    app = await createTestApp();
    admin = await ensureSeedAdmin(app);
    agente = await crearAgente(app, admin, `agente.parecidas.${randomUUID()}@test.local`);
    otroAgente = await crearAgente(app, admin, `otro.parecidas.${randomUUID()}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("normalizar el nombre", () => {
    it("ignora mayúsculas, acentos, puntuación y la forma jurídica", () => {
      expect(normalizarNombreEmpresa("Moldes del Bajío, S.A. de C.V.")).toBe("moldes del bajio");
      expect(normalizarNombreEmpresa("MOLDES DEL BAJIO SA DE CV")).toBe("moldes del bajio");
      expect(normalizarNombreEmpresa("Plásticos Querétaro S.A.P.I. de C.V.")).toBe("plasticos queretaro");
      expect(normalizarNombreEmpresa("Aceros Norte S. de R.L. de C.V.")).toBe("aceros norte");
      expect(normalizarNombreEmpresa("Consultores Unidos, S.C.")).toBe("consultores unidos");
    });

    it("no corta palabras que solo terminan parecido ni deja el nombre vacío", () => {
      expect(normalizarNombreEmpresa("La Casa")).toBe("la casa");
      expect(normalizarNombreEmpresa("Industrias Ibarra")).toBe("industrias ibarra");
      expect(normalizarNombreEmpresa("S.A. de C.V.")).toBe("s a de c v");
    });
  });

  describe("GET /empresas/parecidas", () => {
    it("encuentra la empresa con el mismo nombre escrito distinto, y por nombre comercial", async () => {
      const m = marca();
      const id = await empresa(admin, `Moldes ${m} del Bajío, S.A. de C.V.`);
      const res = await parecidas(admin, `moldes ${m} del bajio sa de cv`);
      expect(res.status).toBe(200);
      expect(res.body.data.map((e: { id: number }) => e.id)).toEqual([id]);
      expect(res.body.data[0]).toEqual(expect.objectContaining({ id, nombre_legal: `Moldes ${m} del Bajío, S.A. de C.V.` }));

      const conComercial = await api().post("/api/v1/empresas").set("Cookie", admin).send({ nombreLegal: `Razón ${m} Uno SA`, nombreComercial: `Marca ${m}`, contactos: [{ nombre: "Contacto", correo: `c.${randomUUID()}@cliente.test` }] });
      expect(conComercial.status).toBe(201);
      expect((await parecidas(admin, `MARCA ${m}`)).body.data.map((e: { id: number }) => e.id)).toEqual([conComercial.body.id]);
    });

    it("un nombre distinto no regresa nada, y se puede excluir la empresa propia", async () => {
      const m = marca();
      const id = await empresa(admin, `Única ${m}`);
      expect((await parecidas(admin, `Otra ${m}`)).body.data).toEqual([]);
      expect((await parecidas(admin, `Única ${m}`, id)).body.data).toEqual([]);
    });

    it("un agente solo ve sus empresas: no se le revela que la de otro existe", async () => {
      const m = marca();
      const delOtro = await empresa(otroAgente, `Reservada ${m}`);
      expect((await parecidas(agente, `Reservada ${m}`)).body.data).toEqual([]);
      expect((await parecidas(otroAgente, `Reservada ${m}`)).body.data.map((e: { id: number }) => e.id)).toEqual([delOtro]);
      expect((await parecidas(admin, `Reservada ${m}`)).body.data.map((e: { id: number }) => e.id)).toEqual([delOtro]);
    });

    it("las desactivadas no cuentan; sin sesión, 401", async () => {
      const m = marca();
      const id = await empresa(admin, `Cerrada ${m}`);
      expect((await api().delete(`/api/v1/empresas/${id}`).set("Cookie", admin)).status).toBe(204);
      expect((await parecidas(admin, `Cerrada ${m}`)).body.data).toEqual([]);
      expect((await api().get("/api/v1/empresas/parecidas").query({ nombre: "x" })).status).toBe(401);
    });
  });

  describe("importación CSV", () => {
    it("la fila avisa de la empresa parecida y se puede confirmar en ella, sin crear otra", async () => {
      const m = marca();
      const existente = await empresa(admin, `Aceros ${m} Norte S.A. de C.V.`);
      const lote = await importar(admin, [`Aceros ${m} Norte,Ana Pérez,ana.${randomUUID()}@cliente.test,correo`]);
      expect(lote.status).toBe(201);
      const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", admin);
      const [fila] = detalle.body.filas;
      expect(fila.empresas_parecidas).toEqual([{ id: existente, nombre: `Aceros ${m} Norte S.A. de C.V.` }]);

      const confirmado = await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${fila.id}/confirmar`).set("Cookie", admin).send({ empresaId: existente });
      expect(confirmado.status).toBe(200);
      expect(confirmado.body.empresa_id).toBe(existente);
      expect((await parecidas(admin, `Aceros ${m} Norte`)).body.data).toHaveLength(1);
    });

    it("sin elegir empresa se sigue creando una nueva, como antes", async () => {
      const m = marca();
      const existente = await empresa(admin, `Textiles ${m}`);
      const lote = await importar(admin, [`Textiles ${m},Luis Gómez,luis.${randomUUID()}@cliente.test,correo`]);
      const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", admin);
      const confirmado = await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${detalle.body.filas[0].id}/confirmar`).set("Cookie", admin).send({});
      expect(confirmado.status).toBe(200);
      expect(confirmado.body.empresa_id).not.toBe(existente);
    });

    it("una fila sin empresa parecida no avisa nada", async () => {
      const lote = await importar(admin, [`Nombre ${randomUUID()},Sin Par,sp.${randomUUID()}@cliente.test,correo`]);
      const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", admin);
      expect(detalle.body.filas[0].empresas_parecidas).toEqual([]);
    });

    it("un agente no puede confirmar en la empresa de otro agente (404) y no ve el aviso", async () => {
      const m = marca();
      const delOtro = await empresa(otroAgente, `Ajena ${m}`);
      const lote = await importar(agente, [`Ajena ${m},Rosa Díaz,rosa.${randomUUID()}@cliente.test,correo`]);
      const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", agente);
      expect(detalle.body.filas[0].empresas_parecidas).toEqual([]);
      const res = await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${detalle.body.filas[0].id}/confirmar`).set("Cookie", agente).send({ empresaId: delOtro });
      expect(res.status).toBe(404);
    });

    describe("confirmar todas", () => {
      const confirmarTodas = (cookie: string[], loteId: string) => api().post(`/api/v1/prospectos/importaciones/${loteId}/confirmar-todos`).set("Cookie", cookie);
      const persona = (empresa: string, nombre: string) => `${empresa},${nombre},${nombre.split(" ")[0]!.toLowerCase()}.${randomUUID()}@cliente.test,correo`;

      it("varias personas de la misma empresa nueva quedan en UNA sola empresa", async () => {
        const m = marca();
        const lote = await importar(admin, [persona(`Moldes ${m} SA de CV`, "Ana Uno"), persona(`Moldes ${m}`, "Beto Dos"), persona(`"MOLDES ${m}, S.A. de C.V."`, "Caro Tres")]);
        const res = await confirmarTodas(admin, lote.body.lote_id);
        expect(res.status).toBe(200);
        expect(res.body).toEqual(expect.objectContaining({ total: 3, confirmados: 3, en_empresa_existente: 2 }));
        expect((await parecidas(admin, `Moldes ${m}`)).body.data).toHaveLength(1);
      });

      it("con una sola empresa parecida en el CRM, la persona se agrega a esa", async () => {
        const m = marca();
        const existente = await empresa(admin, `Aceros ${m} S.A. de C.V.`);
        const lote = await importar(admin, [persona(`Aceros ${m}`, "Dora Cuatro")]);
        const res = await confirmarTodas(admin, lote.body.lote_id);
        expect(res.body).toEqual(expect.objectContaining({ confirmados: 1, en_empresa_existente: 1 }));
        expect((await parecidas(admin, `Aceros ${m}`)).body.data.map((e: { id: number }) => e.id)).toEqual([existente]);
      });

      it("con dos o más parecidas no adivina: la fila se queda por revisar", async () => {
        const m = marca();
        await empresa(admin, `Doble ${m} SA`);
        await empresa(admin, `Doble ${m} S.C.`);
        const lote = await importar(admin, [persona(`Doble ${m}`, "Eva Cinco"), persona(`Distinta ${m}`, "Fer Seis")]);
        const res = await confirmarTodas(admin, lote.body.lote_id);
        expect(res.body).toEqual(expect.objectContaining({ total: 2, confirmados: 1, en_empresa_existente: 0 }));
        expect(res.body.resultados.find((r: { ok: boolean }) => !r.ok).error).toMatch(/2 empresas/);
        const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", admin);
        const pendiente = detalle.body.filas.find((f: { empresa_nombre_legal: string }) => f.empresa_nombre_legal === `Doble ${m}`);
        expect(pendiente.estado).toBe("pendiente_revision");
        expect(pendiente.empresas_parecidas).toHaveLength(2);
        expect((await parecidas(admin, `Doble ${m}`)).body.data).toHaveLength(2);
      });

      it("un agente no se junta con la empresa de otro agente: se le crea la suya", async () => {
        const m = marca();
        const delOtro = await empresa(otroAgente, `Vecina ${m}`);
        const lote = await importar(agente, [persona(`Vecina ${m}`, "Gil Siete")]);
        const res = await confirmarTodas(agente, lote.body.lote_id);
        expect(res.body).toEqual(expect.objectContaining({ confirmados: 1, en_empresa_existente: 0 }));
        const suyas = (await parecidas(agente, `Vecina ${m}`)).body.data.map((e: { id: number }) => e.id);
        expect(suyas).toHaveLength(1);
        expect(suyas).not.toContain(delOtro);
      });
    });

    it("una fila duplicada de una persona que ya existe no acepta otra empresa (409)", async () => {
      const correo = `dup.${randomUUID()}@cliente.test`;
      const original = await api().post("/api/v1/empresas").set("Cookie", admin).send({ nombreLegal: `Dueña ${marca()}`, contactos: [{ nombre: "Dup", correo }] });
      const otra = await empresa(admin, `Otra ${marca()}`);
      const lote = await importar(admin, [`Cualquiera ${marca()},Dup,${correo},correo`]);
      const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", admin);
      expect(detalle.body.filas[0].estado).toBe("duplicado");
      const res = await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${detalle.body.filas[0].id}/confirmar`).set("Cookie", admin).send({ usarContactoExistente: true, empresaId: otra });
      expect(res.status).toBe(409);
      expect(original.status).toBe(201);
    });
  });
});
