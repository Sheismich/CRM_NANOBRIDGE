import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { evento, mandarLote } from "./support/sendgrid.js";
import { auditoria, envios, eventosSendgrid, listaSupresion, mediosContacto, prospectos } from "../src/database/schema.js";
import { env } from "../src/config/env.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Event Webhook de SendGrid directo a la API (044, 20-nov-2026).
describe("webhook de eventos de SendGrid", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);
  const llaveOriginal = env.SENDGRID_WEBHOOK_PUBLIC_KEY;

  async function prospecto() {
    const correo = `rebote.${randomUUID()}@destino.test`;
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Rebote ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo }
    });
    expect(res.status).toBe(201);
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, res.body.id));
    return { id: res.body.id as number, correo };
  }
  const registrar = async (prospectoId: number) => {
    const res = await conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" });
    expect(res.status).toBe(201);
    return res.body.id as number;
  };
  const estadoDe = async (id: number) => (await db.select().from(prospectos).where(eq(prospectos.id, id)))[0]!;
  const suprimido = async (correo: string) => (await db.select().from(listaSupresion).where(and(eq(listaSupresion.tipo, "correo"), eq(listaSupresion.valorNormalizado, correo))))[0];
  const ahora = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `webhook.${randomUUID()}@test.local`);
  });

  afterEach(() => {
    env.SENDGRID_WEBHOOK_PUBLIC_KEY = llaveOriginal;
    env.REBOTES_SUAVES_PARA_DESACTIVAR = 3;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("rechaza una firma que no cuadra y no guarda nada", async () => {
    const ev = evento({ event: "bounce", type: "bounce", email: "nadie@destino.test" });
    const res = await mandarLote(app, [ev], { firma: Buffer.from("firma falsa").toString("base64") });
    expect(res.status).toBe(401);
    expect(await db.select().from(eventosSendgrid).where(eq(eventosSendgrid.sgEventId, ev.sg_event_id))).toHaveLength(0);
  });

  it("sin llave configurada responde 503", async () => {
    env.SENDGRID_WEBHOOK_PUBLIC_KEY = undefined;
    const res = await mandarLote(app, [evento({ event: "delivered", email: "nadie@destino.test" })]);
    expect(res.status).toBe(503);
  });

  it("un rebote duro desactiva solo a ese prospecto, guarda tipo y motivo, y suprime el correo", async () => {
    const p = await prospecto();
    const envioId = await registrar(p.id);
    // Otro prospecto de la misma persona (otra campaña): no se toca.
    const [{ contactoId }] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, p.id));
    const [otro] = await db.insert(prospectos).values({ contactoId, estado: "capturado" });

    const res = await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: p.correo, reason: "550 5.1.1 user unknown", prospecto_id: p.id, envio_id: envioId })]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ procesados: 1, repetidos: 0, descartados: 0 });

    const despues = await estadoDe(p.id);
    expect(despues).toEqual(expect.objectContaining({ estado: "rebotado", tipoRebote: "duro", motivoRebote: "550 5.1.1 user unknown", estadoPrevioRebote: "validado" }));
    expect(despues.fechaRebote).toBeInstanceOf(Date);
    expect((await estadoDe(otro.insertId)).estado).toBe("capturado");
    expect(await suprimido(p.correo)).toEqual(expect.objectContaining({ evento: "bounce" }));
    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, p.id), eq(auditoria.accion, "rebote")));
    expect(audit).toBeDefined();
  });

  it("el mismo evento repetido se procesa una sola vez", async () => {
    const p = await prospecto();
    const ev = evento({ event: "bounce", type: "blocked", email: p.correo, reason: "421 try later", prospecto_id: p.id });
    const res = await mandarLote(app, [ev, ev]);
    expect(res.body).toEqual({ procesados: 1, repetidos: 1, descartados: 0 });
    expect((await mandarLote(app, [ev])).body.repetidos).toBe(1);
    expect(await db.select().from(eventosSendgrid).where(eq(eventosSendgrid.sgEventId, ev.sg_event_id))).toHaveLength(1);
  });

  it("rebotes suaves: con 2 no pasa nada, con 3 seguidos se desactiva y el correo no se suprime", async () => {
    const p = await prospecto();
    const suave = () => evento({ event: "bounce", type: "blocked", email: p.correo, reason: "452 mailbox full", prospecto_id: p.id });
    await mandarLote(app, [suave(), suave()]);
    expect((await estadoDe(p.id)).estado).toBe("validado");

    await mandarLote(app, [suave()]);
    expect(await estadoDe(p.id)).toEqual(expect.objectContaining({ estado: "rebotado", tipoRebote: "suave", motivoRebote: "452 mailbox full" }));
    expect(await suprimido(p.correo)).toBeUndefined();
  });

  it("un delivered entre medio reinicia la cuenta, aunque lleguen en desorden", async () => {
    const p = await prospecto();
    const t = ahora();
    // Llegan en otro orden del que ocurrieron: cuenta la fecha de SendGrid.
    await mandarLote(app, [
      evento({ event: "bounce", type: "blocked", email: p.correo, prospecto_id: p.id, timestamp: t - 10 }),
      evento({ event: "delivered", email: p.correo, prospecto_id: p.id, timestamp: t - 200 }),
      // Ocurrió antes del delivered: ya no cuenta.
      evento({ event: "bounce", type: "blocked", email: p.correo, prospecto_id: p.id, timestamp: t - 300 }),
      evento({ event: "bounce", type: "blocked", email: p.correo, prospecto_id: p.id, timestamp: t - 100 })
    ]);
    // Después del delivered solo hay 2 suaves: sigue activo.
    expect((await estadoDe(p.id)).estado).toBe("validado");
    // El tercero después del delivered sí lo desactiva.
    await mandarLote(app, [evento({ event: "bounce", type: "blocked", email: p.correo, prospecto_id: p.id, timestamp: t - 5 })]);
    expect((await estadoDe(p.id)).estado).toBe("rebotado");
  });

  it("deferred no cuenta como rebote", async () => {
    const p = await prospecto();
    env.REBOTES_SUAVES_PARA_DESACTIVAR = 1;
    await mandarLote(app, [evento({ event: "deferred", email: p.correo, prospecto_id: p.id })]);
    expect((await estadoDe(p.id)).estado).toBe("validado");
    const [fila] = await db.select().from(eventosSendgrid).where(eq(eventosSendgrid.prospectoId, p.id));
    expect(fila!.resultado).toBe("ignorado");
  });

  it("una queja de spam da de baja a la persona y deja sus medios en no contactar", async () => {
    const p = await prospecto();
    await mandarLote(app, [evento({ event: "spamreport", email: p.correo, prospecto_id: p.id })]);
    expect((await estadoDe(p.id)).estado).toBe("baja");
    const [{ contactoId }] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, p.id));
    const medios = await db.select().from(mediosContacto).where(eq(mediosContacto.contactoId, contactoId));
    expect(medios.every((m) => m.estadoContacto === "no_contactar")).toBe(true);
  });

  it("un rebote sin prospect_id (correo de un vendedor) solo suprime el correo", async () => {
    const correo = `vendedor.${randomUUID()}@cliente.test`;
    await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: correo, reason: "550 no such user" })]);
    expect(await suprimido(correo)).toBeDefined();
    const [fila] = await db.select().from(eventosSendgrid).where(eq(eventosSendgrid.correo, correo));
    expect(fila).toEqual(expect.objectContaining({ prospectoId: null, resultado: "suprimido" }));
  });

  it("un envio_id que no es de ese prospecto no desactiva a nadie", async () => {
    const p = await prospecto();
    const otro = await prospecto();
    const envioDelOtro = await registrar(otro.id);
    await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: p.correo, prospecto_id: p.id, envio_id: envioDelOtro })]);
    expect((await estadoDe(p.id)).estado).toBe("validado");
    expect((await estadoDe(otro.id)).estado).toBe("validado");
  });

  it("un evento que no se entiende no tumba el lote", async () => {
    const p = await prospecto();
    const res = await mandarLote(app, [{ event: "bounce" }, evento({ event: "bounce", type: "bounce", email: p.correo, prospecto_id: p.id })]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ procesados: 1, repetidos: 0, descartados: 1 });
  });

  it("a un rebotado no le salen recordatorios", async () => {
    const p = await prospecto();
    const envioId = await registrar(p.id);
    await conLlave(api().post(`/api/v1/automatizacion/envios/${envioId}/confirmacion`)).send({ estado: "enviado", proveedor_id: "msg-1" });
    await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: p.correo, prospecto_id: p.id, envio_id: envioId })]);
    await db.update(envios).set({ ventanaVenceEn: new Date(Date.now() - 60_000) }).where(eq(envios.id, envioId));

    const vencidas = await conLlave(api().get("/api/v1/automatizacion/envios/vencidas")).query({ limit: 50 });
    expect(vencidas.status).toBe(200);
    expect((vencidas.body.data as { envio_id?: number; id?: number }[]).some((v) => (v.envio_id ?? v.id) === envioId)).toBe(false);
  });

  describe("rebotados en Administración", () => {
    const reactivar = (id: number, cookie = adminCookie) => api().post(`/api/v1/admin/rebotes/${id}/reactivar`).set("Cookie", cookie);

    it("lista los rebotados con correo, tipo y motivo", async () => {
      const p = await prospecto();
      await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: p.correo, reason: "550 5.1.1 user unknown", prospecto_id: p.id })]);
      const res = await api().get("/api/v1/admin/rebotes").set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ prospecto_id: p.id, correo: p.correo, tipo_rebote: "duro", motivo_rebote: "550 5.1.1 user unknown" })]));
      expect((await api().get("/api/v1/admin/rebotes").set("Cookie", agenteCookie)).status).toBe(403);
    });

    it("reactivar regresa el prospecto a capturado y quita la supresión del rebote", async () => {
      const p = await prospecto();
      await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: p.correo, prospecto_id: p.id })]);
      expect((await reactivar(p.id, agenteCookie)).status).toBe(403);

      const res = await reactivar(p.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ estado: "capturado", supresion_quitada: true, quitar_de_sendgrid: p.correo }));
      expect(await estadoDe(p.id)).toEqual(expect.objectContaining({ estado: "capturado", tipoRebote: null, fechaRebote: null }));
      expect(await suprimido(p.correo)).toBeUndefined();
      const medios = await db.select().from(mediosContacto).where(eq(mediosContacto.valorNormalizado, p.correo));
      expect(medios.every((m) => m.estadoContacto === "activo")).toBe(true);
      const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, p.id), eq(auditoria.accion, "reactivar_rebote"))).orderBy(desc(auditoria.id));
      expect(audit).toBeDefined();

      expect((await reactivar(p.id)).status).toBe(409);
    });

    it("la baja manda: un rebotado que después se queja queda en baja y ya no se reactiva", async () => {
      const p = await prospecto();
      env.REBOTES_SUAVES_PARA_DESACTIVAR = 1;
      await mandarLote(app, [evento({ event: "bounce", type: "blocked", email: p.correo, prospecto_id: p.id })]);
      expect((await estadoDe(p.id)).estado).toBe("rebotado");

      await mandarLote(app, [evento({ event: "spamreport", email: p.correo })]);
      expect((await estadoDe(p.id)).estado).toBe("baja");
      expect(await suprimido(p.correo)).toEqual(expect.objectContaining({ evento: "spamreport" }));
      expect((await reactivar(p.id)).status).toBe(409);
      expect(await suprimido(p.correo)).toBeDefined();
    });

    it("reactivar un rebote duro no quita una supresión que no es de rebote", async () => {
      const p = await prospecto();
      // El correo ya estaba suprimido por una baja; luego rebota.
      await db.insert(listaSupresion).values({ tipo: "correo", valorNormalizado: p.correo, motivo: "Baja a mano", evento: "unsubscribe" });
      await mandarLote(app, [evento({ event: "bounce", type: "bounce", email: p.correo, prospecto_id: p.id })]);
      expect((await estadoDe(p.id)).estado).toBe("rebotado");

      const res = await reactivar(p.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ supresion_quitada: false, quitar_de_sendgrid: null }));
      expect(await suprimido(p.correo)).toEqual(expect.objectContaining({ evento: "unsubscribe" }));
    });
  });
});
