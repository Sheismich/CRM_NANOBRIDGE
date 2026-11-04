import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { envios, mediosContacto, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// La API elige el correo con correoUtilizable(), la misma regla que usan la
// fila y los recordatorios, y guarda a quién salió. Antes la supresión
// revisaba el primer correo que devolviera la base.
describe("envíos: a qué correo salen y qué pasó con ellos", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  async function prospecto(segundoCorreo = true) {
    const primero = `primero.${randomUUID()}@destino.test`;
    const segundo = `segundo.${randomUUID()}@destino.test`;
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Destino ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo: primero }
    });
    const id = res.body.id as number;
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, id));
    const [fila] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, id));
    const contactoId = fila!.contactoId;
    if (segundoCorreo) await db.insert(mediosContacto).values({ contactoId, tipo: "correo", valor: segundo, valorNormalizado: segundo });
    return { id, contactoId, primero, segundo };
  }

  const registrar = (prospectoId: number, executionId: string = randomUUID()) =>
    conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: executionId, prospecto_id: prospectoId, canal: "correo" });
  const verificar = (prospectoId: number) => conLlave(api().get("/api/v1/automatizacion/envios/verificacion")).query({ prospecto_id: prospectoId, canal: "correo" });
  const rebote = (valor: string) => conLlave(api().post("/api/v1/automatizacion/supresion")).send({ execution_id: randomUUID(), tipo: "correo", valor, motivo: "Rebote definitivo", evento: "bounce" });
  const confirmar = (id: number, cuerpo: Record<string, unknown>) => conLlave(api().post(`/api/v1/automatizacion/envios/${id}/confirmacion`)).send(cuerpo);
  const filaDe = async (id: number) => (await db.select().from(envios).where(eq(envios.id, id)))[0]!;
  const salud = async () => (await api().get("/api/v1/admin/salud").set("Cookie", adminCookie)).body.correos as { enviados_hoy: number; sin_confirmar: number };

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("a qué correo sale", () => {
    it("si el primero rebotó, sale al segundo en vez de bloquear a la persona", async () => {
      const p = await prospecto();
      await rebote(p.primero);

      expect((await verificar(p.id)).body).toEqual(expect.objectContaining({ puede_enviar: true }));
      const res = await registrar(p.id);
      expect(res.status).toBe(201);
      expect(res.body.destinatario).toBe(p.segundo);
      expect(await filaDe(res.body.id)).toEqual(expect.objectContaining({ destinatario: p.segundo, estado: "registrado" }));
    });

    it("si el segundo rebotó, sigue saliendo al primero", async () => {
      const p = await prospecto();
      await rebote(p.segundo);
      const res = await registrar(p.id);
      expect(res.status).toBe(201);
      expect(res.body.destinatario).toBe(p.primero);
    });

    it("con todos suprimidos no pasa, y no guarda nada", async () => {
      const p = await prospecto();
      await rebote(p.primero);
      await rebote(p.segundo);

      expect((await verificar(p.id)).body).toEqual(expect.objectContaining({ puede_enviar: false, motivo: "El contacto está en la lista de supresión" }));
      const res = await registrar(p.id);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/lista de supresión/);
      expect(await db.select().from(envios).where(eq(envios.prospectoId, p.id))).toHaveLength(0);
    });

    it("sin ningún correo utilizable no pasa", async () => {
      const p = await prospecto(false);
      await db.update(mediosContacto).set({ estadoContacto: "obsoleto" }).where(and(eq(mediosContacto.contactoId, p.contactoId), eq(mediosContacto.tipo, "correo")));

      expect((await verificar(p.id)).body).toEqual(expect.objectContaining({ puede_enviar: false, motivo: "El contacto no tiene un correo utilizable" }));
      const res = await registrar(p.id);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe("El contacto no tiene un correo utilizable");
    });

    it("un reintento devuelve el destinatario original aunque ese correo ya no se pueda usar", async () => {
      const p = await prospecto();
      const executionId = randomUUID();
      const primera = await registrar(p.id, executionId);
      await rebote(p.primero);

      const segunda = await registrar(p.id, executionId);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toEqual(expect.objectContaining({ id: primera.body.id, destinatario: p.primero, ya_existia: true }));
    });

    it("una supresión al mismo tiempo que el envío no truena ninguno de los dos", async () => {
      const p = await prospecto();
      const [envio, supresion, otra] = await Promise.all([registrar(p.id), rebote(p.primero), rebote(p.segundo)]);
      expect([201, 409]).toContain(envio.status);
      expect([supresion.status, otra.status]).toEqual([201, 201]);
    });
  });

  describe("confirmación de n8n", () => {
    async function envioNuevo() {
      const res = await registrar((await prospecto(false)).id);
      return res.body.id as number;
    }

    it("enviado guarda el id de SendGrid, y repetirlo no cambia nada", async () => {
      const id = await envioNuevo();
      const res = await confirmar(id, { estado: "enviado", proveedor_id: "sg-123" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, estado: "enviado" });
      expect((await confirmar(id, { estado: "enviado", proveedor_id: "sg-123" })).status).toBe(200);
      expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "enviado", proveedorId: "sg-123", error: null }));
    });

    it("un fallido tardío no pisa a un enviado", async () => {
      const id = await envioNuevo();
      await confirmar(id, { estado: "enviado", proveedor_id: "sg-456" });
      const res = await confirmar(id, { estado: "fallido", error: "timeout" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id, estado: "enviado" });
      expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "enviado", error: null }));
    });

    it("un reintento que sí salió convierte el fallido en enviado", async () => {
      const id = await envioNuevo();
      await confirmar(id, { estado: "fallido", error: "SendGrid respondió 500" });
      expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "fallido", error: "SendGrid respondió 500" }));
      await confirmar(id, { estado: "enviado", proveedor_id: "sg-789" });
      expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "enviado", proveedorId: "sg-789", error: null }));
    });

    it("un envío que no existe da 404 y sin llave no entra", async () => {
      expect((await confirmar(99_999_999, { estado: "enviado" })).status).toBe(404);
      expect((await api().post("/api/v1/automatizacion/envios/1/confirmacion").send({ estado: "enviado" })).status).toBe(401);
    });

    it("un fallido sigue contando para la política: la ventana de espera no se abre de nuevo", async () => {
      const p = await prospecto(false);
      const id = (await registrar(p.id)).body.id as number;
      await confirmar(id, { estado: "fallido", error: "x" });
      const otro = await registrar(p.id);
      expect(otro.status).toBe(409);
      expect(otro.body.message).toMatch(/Ventana de espera/);
    });

    it("un fallido no cuenta como correo enviado, y uno sin confirmar se señala después de una hora", async () => {
      const antes = await salud();
      const fallido = await envioNuevo();
      expect((await salud()).enviados_hoy).toBe(antes.enviados_hoy + 1);
      await confirmar(fallido, { estado: "fallido", error: "x" });
      expect((await salud()).enviados_hoy).toBe(antes.enviados_hoy);

      const sinConfirmar = await envioNuevo();
      expect((await salud()).sin_confirmar).toBe(antes.sin_confirmar);
      await db.update(envios).set({ enviadoEn: new Date(Date.now() - 2 * 60 * 60 * 1000) }).where(eq(envios.id, sinConfirmar));
      expect((await salud()).sin_confirmar).toBe(antes.sin_confirmar + 1);
    });
  });
});
