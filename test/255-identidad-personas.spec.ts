import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { contactos, mediosContacto } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Identidad de una persona (decisión de Fabián, 2-oct-2026: "el correo
// manda"). Antes se buscaba "correo O teléfono, el primero que coincida":
// dos personas que comparten el conmutador de su empresa quedaban fundidas
// en una, el correo de la segunda ni se guardaba, y los recordatorios, el
// límite de 3 contactos y las bajas se aplicaban a la persona equivocada
// (hallazgo del /code-review del 2-oct-2026).
describe("identidad de personas: el correo manda", () => {
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
  const correoNuevo = () => `identidad.${randomUUID()}@identidad.test`;
  const telefonoNuevo = () => `55${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

  function registrarPorN8n(contacto: { correo?: string; telefono?: string; nombre?: string }) {
    return api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Identidad ${randomUUID()}` }, contacto: { nombre: contacto.nombre ?? "Persona Identidad", ...contacto } });
  }

  async function mediosDe(contactoId: number) {
    return db.select({ tipo: mediosContacto.tipo, valor: mediosContacto.valorNormalizado }).from(mediosContacto).where(eq(mediosContacto.contactoId, contactoId));
  }

  describe("registro desde n8n", () => {
    it("mismo teléfono (conmutador) con otro correo: persona NUEVA en la misma empresa, con su correo guardado", async () => {
      const conmutador = telefonoNuevo();
      const a = await registrarPorN8n({ correo: correoNuevo(), telefono: conmutador, nombre: "Persona A" });
      expect(a.status).toBe(201);

      const correoB = correoNuevo();
      const b = await registrarPorN8n({ correo: correoB, telefono: conmutador, nombre: "Persona B" });
      expect(b.status).toBe(201);
      expect(b.body.duplicado).toBe(false);
      expect(b.body.empresa_reutilizada).toBe(true);
      expect(b.body.contacto_id).not.toBe(a.body.contacto_id);
      expect(b.body.empresa_id).toBe(a.body.empresa_id);

      // B tiene su correo; el teléfono sigue siendo solo de A (no se duplica).
      expect(await mediosDe(b.body.contacto_id)).toEqual([{ tipo: "correo", valor: correoB }]);
      expect((await mediosDe(a.body.contacto_id)).some((m) => m.tipo === "telefono")).toBe(true);
    });

    it("una baja de A ya no bloquea a B", async () => {
      const conmutador = telefonoNuevo();
      const correoA = correoNuevo();
      await registrarPorN8n({ correo: correoA, telefono: conmutador });
      const b = await registrarPorN8n({ correo: correoNuevo(), telefono: conmutador });

      const baja = await api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), tipo: "correo", valor: correoA, motivo: "baja de A", evento: "unsubscribe" });
      expect(baja.status).toBe(201);

      const verificacion = await api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: b.body.id, canal: "correo" });
      expect(verificacion.body.puede_enviar).toBe(true);
    });

    it("mismo correo: misma persona (como siempre)", async () => {
      const correo = correoNuevo();
      const a = await registrarPorN8n({ correo });
      const b = await registrarPorN8n({ correo, telefono: telefonoNuevo() });
      expect(b.body).toMatchObject({ duplicado: true, contacto_id: a.body.contacto_id });
    });

    it("sin correo: el teléfono identifica, también si ya existía como WhatsApp", async () => {
      const numero = telefonoNuevo();
      const creada = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa WhatsApp ${randomUUID()}`, contactos: [{ nombre: "Persona WhatsApp", whatsapp: numero }] });
      expect(creada.status).toBe(201);
      const [contacto] = await db.select({ id: contactos.id }).from(contactos).where(eq(contactos.empresaId, creada.body.id));

      const res = await registrarPorN8n({ telefono: numero });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ duplicado: true, contacto_id: contacto!.id });
    });
  });

  describe("CRM: alta manual e importación", () => {
    function altaManual(body: Record<string, unknown>) {
      return api().post("/api/v1/prospectos").set("Cookie", adminCookie).send({ empresaNombreLegal: `Empresa CRM ${randomUUID()}`, contactoNombre: "Persona CRM", canalInicial: "correo", ...body });
    }

    function confirmar(loteId: string, id: number, usarContactoExistente = false) {
      return api().post(`/api/v1/prospectos/importaciones/${loteId}/filas/${id}/confirmar`).set("Cookie", adminCookie).send({ usarContactoExistente });
    }

    it("mismo teléfono con otro correo NO es duplicado; al confirmar queda en la empresa del teléfono, sin 500", async () => {
      const conmutador = telefonoNuevo();
      const a = await registrarPorN8n({ correo: correoNuevo(), telefono: conmutador });

      const correoB = correoNuevo();
      const borrador = await altaManual({ correo: correoB, telefono: conmutador });
      expect(borrador.status).toBe(201);
      expect(borrador.body).toMatchObject({ estado: "pendiente_revision", match_contacto_id: null });

      const res = await confirmar(borrador.body.lote_id, borrador.body.id);
      expect(res.status).toBe(200);
      expect(res.body.empresa_id).toBe(a.body.empresa_id);
      expect(res.body.contacto_id).not.toBe(a.body.contacto_id);
      expect(await mediosDe(res.body.contacto_id)).toEqual([{ tipo: "correo", valor: correoB }]);
    });

    it("sin correo y mismo teléfono: sí es duplicado de esa persona", async () => {
      const numero = telefonoNuevo();
      const a = await registrarPorN8n({ correo: correoNuevo(), telefono: numero });
      const borrador = await altaManual({ telefono: numero, canalInicial: "telefono" });
      expect(borrador.body).toMatchObject({ estado: "duplicado", match_contacto_id: a.body.contacto_id, match_motivo: "telefono" });
    });

    it("dentro del mismo archivo: dos filas con el mismo conmutador y distinto correo son dos personas", async () => {
      const conmutador = telefonoNuevo();
      const csv = ["empresaNombreLegal,contactoNombre,correo,telefono,canalInicial", `Empresa Archivo ${randomUUID()},Persona Uno,${correoNuevo()},${conmutador},correo`, `Empresa Archivo ${randomUUID()},Persona Dos,${correoNuevo()},${conmutador},correo`, `Empresa Archivo ${randomUUID()},Persona Tres,,${conmutador},telefono`].join("\n");
      const res = await api().post("/api/v1/prospectos/importaciones").set("Cookie", adminCookie).attach("archivo", Buffer.from(csv), `identidad-${randomUUID()}.csv`);
      expect(res.status).toBe(201);
      // Uno y Dos: personas distintas. Tres (sin correo, mismo teléfono): duplicado de una fila del archivo.
      expect(res.body.resumen).toMatchObject({ pendiente_revision: 2, duplicado: 1 });
    });

    it("una fila sin coincidencias que entretanto choca con alguien: al confirmar se revisa de nuevo", async () => {
      const correo = correoNuevo();
      const borrador = await altaManual({ correo });
      expect(borrador.body.estado).toBe("pendiente_revision");
      // La misma persona entra por n8n antes de que se confirme la fila.
      await registrarPorN8n({ correo });

      const res = await confirmar(borrador.body.lote_id, borrador.body.id);
      expect(res.status).toBe(409);
      const [medio] = await db.select({ contactoId: mediosContacto.contactoId }).from(mediosContacto).where(and(eq(mediosContacto.tipo, "correo"), eq(mediosContacto.valorNormalizado, correo)));
      expect(medio).toBeDefined();
    });
  });
});
