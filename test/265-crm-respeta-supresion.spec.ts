import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, mediosContacto } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// El CRM respeta la lista de supresión (A4 del plan de fixes, 2-oct-2026).
// Antes nada en src/crm leía lista_supresion: editando un contacto se podía
// cambiar o borrar un correo en no_contactar y luego volver a ponerlo como
// activo, y a una persona dada de baja se le podían agregar medios nuevos
// como activos. Los correos automáticos seguían bloqueados (/envios revisa
// la lista), pero las llamadas y WhatsApp de un agente no.
describe("el CRM respeta la lista de supresión", () => {
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
  const correoNuevo = () => `supresion.crm.${randomUUID()}@crm.test`;
  const telefonoNuevo = () => `55${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

  function suprimir(tipo: "correo" | "telefono", valor: string, evento?: string) {
    return api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), tipo, valor, motivo: "prueba de supresión", ...(evento ? { evento } : {}) });
  }

  async function crearEmpresa(contacto: Record<string, unknown>) {
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa Supresión CRM ${randomUUID()}`, contactos: [{ nombre: "Persona Supresión", ...contacto }] });
    expect(res.status).toBe(201);
    const [contactoFila] = await db.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, res.body.id));
    return { empresaId: res.body.id as number, contactoId: contactoFila!.id };
  }

  async function medios(contactoId: number) {
    const filas = await db.select({ tipo: mediosContacto.tipo, valor: mediosContacto.valorNormalizado, estado: mediosContacto.estadoContacto }).from(mediosContacto).where(eq(mediosContacto.contactoId, contactoId));
    return Object.fromEntries(filas.map((f) => [f.tipo, f]));
  }

  function editar(contactoId: number, body: Record<string, unknown>) {
    return api().patch(`/api/v1/contactos/${contactoId}`).set("Cookie", adminCookie).send(body);
  }

  describe("editar un contacto", () => {
    it("cambiar un correo en no_contactar: 409 MEDIO_SUPRIMIDO y el correo sigue bloqueado", async () => {
      const correo = correoNuevo();
      const { contactoId } = await crearEmpresa({ correo, telefono: telefonoNuevo() });
      expect((await suprimir("correo", correo)).status).toBe(201);

      const res = await editar(contactoId, { correo: correoNuevo() });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("MEDIO_SUPRIMIDO");
      expect((await medios(contactoId)).correo).toMatchObject({ valor: correo, estado: "no_contactar" });
    });

    it("borrar un correo en no_contactar: 409 MEDIO_SUPRIMIDO", async () => {
      const correo = correoNuevo();
      const { contactoId } = await crearEmpresa({ correo, telefono: telefonoNuevo() });
      await suprimir("correo", correo);

      const res = await editar(contactoId, { correo: null });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("MEDIO_SUPRIMIDO");
    });

    it("a una persona en baja, un teléfono nuevo se guarda bloqueado", async () => {
      const correo = correoNuevo();
      const { contactoId } = await crearEmpresa({ correo });
      // La baja necesita un prospecto: entra por n8n con el mismo correo.
      const registro = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), empresa: { nombreLegal: "Empresa Supresión n8n" }, contacto: { nombre: "Persona Supresión", correo } });
      expect(registro.body.contacto_id).toBe(contactoId);
      expect((await suprimir("correo", correo, "unsubscribe")).status).toBe(201);

      const res = await editar(contactoId, { telefono: telefonoNuevo() });
      expect(res.status).toBe(200);
      expect((await medios(contactoId)).telefono!.estado).toBe("no_contactar");
    });

    it("una persona dada de baja se puede seguir editando (corregir su puesto)", async () => {
      const correo = correoNuevo();
      const { contactoId } = await crearEmpresa({ correo });
      const registro = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), empresa: { nombreLegal: "Empresa Supresión n8n" }, contacto: { nombre: "Persona Supresión", correo } });
      expect(registro.body.contacto_id).toBe(contactoId);
      await suprimir("correo", correo, "unsubscribe");

      const res = await editar(contactoId, { puesto: "Gerente de compras" });
      expect(res.status).toBe(200);
    });

    it("un correo nuevo que está en la lista de supresión se guarda bloqueado", async () => {
      const suprimido = correoNuevo();
      await suprimir("correo", suprimido);
      const { contactoId } = await crearEmpresa({ telefono: telefonoNuevo() });

      expect((await editar(contactoId, { correo: suprimido })).status).toBe(200);
      expect((await medios(contactoId)).correo).toMatchObject({ valor: suprimido, estado: "no_contactar" });
    });
  });

  describe("altas de medios", () => {
    it("crear una empresa con un correo suprimido: el medio nace en no_contactar", async () => {
      const suprimido = correoNuevo();
      await suprimir("correo", suprimido);
      const { contactoId } = await crearEmpresa({ correo: suprimido });
      expect((await medios(contactoId)).correo!.estado).toBe("no_contactar");
    });

    it("un teléfono suprimido como WhatsApp nace bloqueado aunque se dé de alta como teléfono", async () => {
      const numero = telefonoNuevo();
      const { contactoId: dueno } = await crearEmpresa({ whatsapp: numero, correo: correoNuevo() });
      await api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), tipo: "whatsapp", valor: numero, motivo: "baja por WhatsApp" });
      expect((await medios(dueno)).whatsapp!.estado).toBe("no_contactar");

      const { contactoId } = await crearEmpresa({ telefono: numero, correo: correoNuevo() });
      expect((await medios(contactoId)).telefono!.estado).toBe("no_contactar");
    });

    it("alta manual de prospecto (CRM) con un correo suprimido: nace bloqueado y la respuesta lo indica", async () => {
      const suprimido = correoNuevo();
      await suprimir("correo", suprimido);
      const borrador = await api().post("/api/v1/prospectos").set("Cookie", adminCookie).send({ empresaNombreLegal: `Empresa Manual ${randomUUID()}`, contactoNombre: "Persona Manual", correo: suprimido, canalInicial: "correo" });
      expect(borrador.status).toBe(201);

      const res = await api().post(`/api/v1/prospectos/importaciones/${borrador.body.lote_id}/filas/${borrador.body.id}/confirmar`).set("Cookie", adminCookie).send({ usarContactoExistente: false });
      expect(res.status).toBe(200);
      expect(res.body.medios_suprimidos).toEqual(["correo"]);
      expect((await medios(res.body.contacto_id)).correo!.estado).toBe("no_contactar");
    });

    it("n8n registra a alguien con un correo suprimido: el medio nace bloqueado", async () => {
      const suprimido = correoNuevo();
      await suprimir("correo", suprimido);
      const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa n8n ${randomUUID()}` }, contacto: { nombre: "Persona n8n", correo: suprimido } });
      expect(res.status).toBe(201);
      expect((await medios(res.body.contacto_id)).correo!.estado).toBe("no_contactar");
    });
  });
});
