import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Identidad contra contactos y empresas desactivados (code review de
// verificación, 5-oct-2026). Desactivar NO borra los medios (el UNIQUE
// global de medios_contacto sigue apartando ese correo/teléfono), así que la
// persona sigue siendo la misma; lo que no puede pasar es que una persona
// NUEVA quede dentro de una empresa desactivada, ni que el CRM cuelgue un
// prospecto invisible de un contacto desactivado.
describe("identidad: contactos y empresas desactivados", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());
  const correoNuevo = () => `inactivos.${randomUUID()}@identidad.test`;
  const telefonoNuevo = () => `56${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;

  function registrarPorN8n(contacto: { correo?: string; telefono?: string }) {
    return api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Inactivos ${randomUUID()}` }, contacto: { nombre: "Persona Inactivos", ...contacto } });
  }

  function altaManual(body: Record<string, unknown>) {
    return api().post("/api/v1/prospectos").set("Cookie", adminCookie).send({ empresaNombreLegal: `Empresa CRM ${randomUUID()}`, contactoNombre: "Persona CRM", canalInicial: "correo", ...body });
  }

  function confirmar(loteId: string, id: number, usarContactoExistente = false) {
    return api().post(`/api/v1/prospectos/importaciones/${loteId}/filas/${id}/confirmar`).set("Cookie", adminCookie).send({ usarContactoExistente });
  }

  async function desactivarEmpresa(empresaId: number) {
    const res = await api().delete(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    expect(res.status).toBeLessThan(300);
  }

  it("n8n: persona nueva con el conmutador de una empresa desactivada va a una empresa nueva, no a la borrada", async () => {
    const conmutador = telefonoNuevo();
    const a = await registrarPorN8n({ correo: correoNuevo(), telefono: conmutador });
    await desactivarEmpresa(a.body.empresa_id);

    const b = await registrarPorN8n({ correo: correoNuevo(), telefono: conmutador });
    expect(b.status).toBe(201);
    expect(b.body.duplicado).toBe(false);
    expect(b.body.empresa_reutilizada).toBe(false);
    expect(b.body.empresa_id).not.toBe(a.body.empresa_id);
  });

  it("CRM: al confirmar a una persona nueva con el conmutador de una empresa desactivada, queda en una empresa nueva", async () => {
    const conmutador = telefonoNuevo();
    const a = await registrarPorN8n({ correo: correoNuevo(), telefono: conmutador });
    await desactivarEmpresa(a.body.empresa_id);

    const borrador = await altaManual({ correo: correoNuevo(), telefono: conmutador });
    const res = await confirmar(borrador.body.lote_id, borrador.body.id);
    expect(res.status).toBe(200);
    expect(res.body.empresa_id).not.toBe(a.body.empresa_id);
  });

  it("CRM: confirmar una fila como duplicado de un contacto desactivado es 409 CONTACTO_DESACTIVADO", async () => {
    const correo = correoNuevo();
    const a = await registrarPorN8n({ correo });
    await desactivarEmpresa(a.body.empresa_id);

    const borrador = await altaManual({ correo });
    expect(borrador.body).toMatchObject({ estado: "duplicado", match_contacto_id: a.body.contacto_id });

    const res = await confirmar(borrador.body.lote_id, borrador.body.id, true);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTACTO_DESACTIVADO");
  });

  it("n8n: la misma persona desactivada sigue siendo ella (no choca con el UNIQUE) y no se le envía nada", async () => {
    const correo = correoNuevo();
    const a = await registrarPorN8n({ correo });
    await desactivarEmpresa(a.body.empresa_id);

    const b = await registrarPorN8n({ correo });
    expect(b.status).toBe(201);
    expect(b.body).toMatchObject({ duplicado: true, contacto_id: a.body.contacto_id });

    const verificacion = await api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: b.body.id, canal: "correo" });
    expect(verificacion.body.puede_enviar).toBe(false);
  });
});
