import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { evento, mandarLote } from "./support/sendgrid.js";
import { auditoria, envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// #4 de la revisión del 20-nov-2026: si SendGrid sí recibió el correo pero
// tardó en contestar, n8n lo reporta como fallido y la API lo reprogramaba:
// la persona lo recibía dos veces. Cualquier aviso de SendGrid de ese envío
// (entregado, en espera, rebotado...) prueba que SendGrid lo recibió.
describe("envío reportado como fallido que SendGrid sí recibió", () => {
  let app: INestApplication;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function prospecto() {
    const correo = `entregado.${randomUUID()}@destino.test`;
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Entregado ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo }
    });
    const id = res.body.id as number;
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, id));
    return { id, correo };
  }

  const registrar = (prospectoId: number, executionId: string = randomUUID()) =>
    conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: executionId, prospecto_id: prospectoId, canal: "correo" });
  const confirmar = (id: number, cuerpo: Record<string, unknown>) => conLlave(api().post(`/api/v1/automatizacion/envios/${id}/confirmacion`)).send(cuerpo);
  const filaDe = async (id: number) => (await db.select().from(envios).where(eq(envios.id, id)))[0]!;
  const estadoDe = async (id: number) => (await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, id)))[0]!.estado;
  const aviso = async (p: { id: number; correo: string }, envioId: number, event = "delivered") => {
    const res = await mandarLote(app, [evento({ event, email: p.correo, prospecto_id: p.id, envio_id: envioId })]);
    expect(res.status).toBe(200);
  };
  const rastro = (envioId: number) =>
    db.select({ despues: auditoria.despues }).from(auditoria).where(and(eq(auditoria.entidad, "envio"), eq(auditoria.entidadId, envioId), eq(auditoria.accion, "envio_recibido_por_sendgrid")));

  it("el aviso llega antes que el 'fallido' de n8n: queda enviado y no se reprograma", async () => {
    const p = await prospecto();
    const id = (await registrar(p.id)).body.id as number;
    await aviso(p, id);
    // Mientras n8n no confirma, el aviso no cambia nada.
    expect((await filaDe(id)).estado).toBe("registrado");

    const res = await confirmar(id, { estado: "fallido", error: "timeout" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id, estado: "enviado" });
    expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "enviado", ventanaEstado: "abierta" }));
    expect(await estadoDe(p.id)).toBe("validado");
    expect(await rastro(id)).toHaveLength(1);
  });

  it("el aviso llega después de un primer correo 'fallido': vuelve a enviado y sale de la fila", async () => {
    const p = await prospecto();
    const id = (await registrar(p.id)).body.id as number;
    await confirmar(id, { estado: "fallido", error: "timeout" });
    expect(await estadoDe(p.id)).toBe("en_fila");

    await aviso(p, id);
    expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "enviado", ventanaEstado: "abierta" }));
    expect(await estadoDe(p.id)).toBe("validado");
    const [fila] = await rastro(id);
    expect(fila!.despues).toMatchObject({ estado: "enviado", deshizo: "vuelta_a_fila" });

    // Ya no se puede registrar otro primer correo: la ventana de este sigue abierta.
    expect((await registrar(p.id)).status).toBe(409);
  });

  it("el aviso llega después de un recordatorio 'fallido': se cierra la ventana que se había vuelto a abrir", async () => {
    const p = await prospecto();
    const primero = (await registrar(p.id)).body.id as number;
    await confirmar(primero, { estado: "enviado", proveedor_id: "sg-1" });
    await db.update(envios).set({ ventanaEstado: "vencida" }).where(eq(envios.id, primero));

    const recordatorio = (await registrar(p.id, `recordatorio-${primero}`)).body.id as number;
    await confirmar(recordatorio, { estado: "fallido", error: "timeout" });
    expect((await filaDe(primero)).ventanaEstado).toBe("abierta");

    await aviso(p, recordatorio, "deferred");
    expect(await filaDe(recordatorio)).toEqual(expect.objectContaining({ estado: "enviado", ventanaEstado: "abierta" }));
    expect((await filaDe(primero)).ventanaEstado).toBe("vencida");
    const [fila] = await rastro(recordatorio);
    expect(fila!.despues).toMatchObject({ estado: "enviado", deshizo: "ventana_reabierta" });
  });

  it("si el envío ya se volvió a registrar, el aviso tardío no lo toca", async () => {
    const p = await prospecto();
    const id = (await registrar(p.id)).body.id as number;
    await confirmar(id, { estado: "fallido", error: "timeout" });
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, p.id));
    expect((await registrar(p.id)).body).toEqual(expect.objectContaining({ id }));

    await aviso(p, id);
    expect((await filaDe(id)).estado).toBe("registrado");
    expect(await rastro(id)).toHaveLength(0);
  });

  it("un aviso repetido (mismo sg_event_id) no vuelve a deshacer nada", async () => {
    const p = await prospecto();
    const id = (await registrar(p.id)).body.id as number;
    await confirmar(id, { estado: "fallido", error: "timeout" });
    const ev = evento({ event: "delivered", email: p.correo, prospecto_id: p.id, envio_id: id });
    expect((await mandarLote(app, [ev])).status).toBe(200);
    expect((await mandarLote(app, [ev])).status).toBe(200);
    expect(await rastro(id)).toHaveLength(1);
  });

  it("un fallido sin ningún aviso de SendGrid se reprograma como siempre", async () => {
    const p = await prospecto();
    const id = (await registrar(p.id)).body.id as number;
    const res = await confirmar(id, { estado: "fallido", error: "SendGrid respondió 500" });
    expect(res.body).toEqual({ id, estado: "fallido" });
    expect(await filaDe(id)).toEqual(expect.objectContaining({ estado: "fallido", ventanaEstado: "cerrada" }));
    expect(await estadoDe(p.id)).toBe("en_fila");
  });
});
