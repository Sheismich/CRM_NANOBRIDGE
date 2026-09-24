import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, listaSupresion, mediosContacto, prospectos } from "../src/database/schema.js";
import { registrarSupresion } from "../src/shared/supresion.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Registro de supresión: el endpoint que usa n8n (POST
// /automatizacion/supresion) y la función compartida que también usan las
// clasificaciones "baja" dentro de su propia transacción. No tenía
// cobertura propia.
describe("supresión", () => {
  let app: INestApplication;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function registrarProspecto() {
    const correo = `supresion.${randomUUID()}@supresion.test`;
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Supresión ${randomUUID()}` }, contacto: { nombre: "Persona Supresión", correo } });
    expect(res.status).toBe(201);
    const [prospecto] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, res.body.id));
    return { id: res.body.id as number, contactoId: prospecto!.contactoId, correo };
  }

  async function estadoDelCorreo(contactoId: number) {
    const [medio] = await db.select({ estado: mediosContacto.estadoContacto }).from(mediosContacto).where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.tipo, "correo")));
    return medio!.estado;
  }

  function registrarPorEndpoint(valor: string) {
    return api()
      .post("/api/v1/automatizacion/supresion")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), tipo: "correo", valor, motivo: "pidió no ser contactado" });
  }

  describe("POST /automatizacion/supresion (n8n)", () => {
    it("registra la supresión normalizada, marca el medio como no_contactar, audita y bloquea el envío", async () => {
      const prospecto = await registrarProspecto();

      const res = await registrarPorEndpoint(`  ${prospecto.correo.toUpperCase()} `);
      expect(res.status).toBe(201);
      expect(res.body.ya_existia).toBe(false);

      const consulta = await api().get("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).query({ tipo: "correo", valor: prospecto.correo });
      expect(consulta.body).toEqual({ en_supresion: true, motivo: "pidió no ser contactado" });
      expect(await estadoDelCorreo(prospecto.contactoId)).toBe("no_contactar");

      const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.accion, "registrar_supresion"), eq(auditoria.entidadId, res.body.id)));
      expect(audit).toBeDefined();

      const verificacion = await api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: prospecto.id, canal: "correo" });
      expect(verificacion.body.puede_enviar).toBe(false);
      expect(verificacion.body.motivo).toBe("El contacto está en la lista de supresión");
    });

    it("registrar el mismo correo otra vez es idempotente: 200 con el mismo id y ya_existia", async () => {
      const prospecto = await registrarProspecto();
      const primera = await registrarPorEndpoint(prospecto.correo);
      const segunda = await registrarPorEndpoint(prospecto.correo);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toEqual({ id: primera.body.id, ya_existia: true });
    });
  });

  describe("registrarSupresion() dentro de una transacción ajena", () => {
    it("si la transacción de quien la llama hace rollback, la supresión tampoco queda", async () => {
      const prospecto = await registrarProspecto();

      await expect(db.transaction(async (tx) => {
        await registrarSupresion(tx, { tipo: "correo", valor: prospecto.correo, motivo: "prueba de rollback", executionId: null, usuarioId: null });
        throw new Error("falla posterior de quien llama");
      })).rejects.toThrow("falla posterior de quien llama");

      const filas = await db.select().from(listaSupresion).where(eq(listaSupresion.valorNormalizado, prospecto.correo));
      expect(filas).toHaveLength(0);
      expect(await estadoDelCorreo(prospecto.contactoId)).toBe("activo");
    });

    it("un correo ya suprimido devuelve ya_existia sin romper la transacción de quien la llama", async () => {
      const prospecto = await registrarProspecto();
      const primera = await registrarPorEndpoint(prospecto.correo);

      const resultado = await db.transaction(async (tx) => {
        const r = await registrarSupresion(tx, { tipo: "correo", valor: prospecto.correo, motivo: "segunda vez", executionId: null, usuarioId: null });
        // La transacción sigue usable después del duplicado.
        await tx.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, prospecto.id));
        return r;
      });
      expect(resultado).toEqual({ id: primera.body.id, ya_existia: true });
    });

    it("guarda en la auditoría al usuario que la originó", async () => {
      const prospecto = await registrarProspecto();
      const adminCookie = await ensureSeedAdmin(app);
      const usuarioId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id as number;

      const resultado = await db.transaction((tx) => registrarSupresion(tx, { tipo: "correo", valor: prospecto.correo, motivo: "baja manual", executionId: null, usuarioId }));
      const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.accion, "registrar_supresion"), eq(auditoria.entidadId, resultado.id)));
      expect(audit!.usuarioId).toBe(usuarioId);
    });
  });
});
