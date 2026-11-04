import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { auditoria, envios, listaSupresion, notificaciones, parametrosAutomatizacion, prospectos } from "../src/database/schema.js";
import { env } from "../src/config/env.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Una lista mala quema un dominio nuevo. A 20 correos al día los porcentajes
// engañan, así que el freno cuenta quejas y rebotes de los últimos 7 días.
describe("freno automático del dominio", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);
  const quejasOriginal = env.FRENO_QUEJAS_7D;
  const rebotesOriginal = env.FRENO_REBOTES_7D;

  async function prospecto() {
    const correo = `freno.${randomUUID()}@destino.test`;
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Freno ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo }
    });
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, res.body.id));
    return { id: res.body.id as number, correo };
  }

  const supresion = (evento: "bounce" | "spamreport" | undefined) =>
    conLlave(api().post("/api/v1/automatizacion/supresion")).send({ execution_id: randomUUID(), tipo: "correo", valor: `evento.${randomUUID()}@destino.test`, motivo: "Evento de SendGrid", evento });
  const registrar = (prospectoId: number) => conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo" });
  const verificar = (prospectoId: number) => conLlave(api().get("/api/v1/automatizacion/envios/verificacion")).query({ prospecto_id: prospectoId, canal: "correo" });
  const salud = async () => (await api().get("/api/v1/admin/salud").set("Cookie", adminCookie)).body.freno as { pausado: boolean; motivo: string | null; quejas_7d: number; rebotes_7d: number };
  const reanudar = (cookie = adminCookie) => api().post("/api/v1/admin/freno-dominio/reanudar").set("Cookie", cookie);

  // La base la comparten todas las pruebas: el límite se pone sobre lo que ya hay.
  async function limitesA(quejas: number, rebotes: number) {
    const hoy = await salud();
    env.FRENO_QUEJAS_7D = hoy.quejas_7d + quejas;
    env.FRENO_REBOTES_7D = hoy.rebotes_7d + rebotes;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `freno.${randomUUID()}@test.local`);
  });

  afterEach(async () => {
    if ((await salud()).pausado) await reanudar();
    env.FRENO_QUEJAS_7D = quejasOriginal;
    env.FRENO_REBOTES_7D = rebotesOriginal;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("por debajo del límite no pasa nada", async () => {
    await limitesA(2, 2);
    await supresion("bounce");
    await supresion("spamreport");
    expect((await salud()).pausado).toBe(false);
  });

  it("al llegar al límite de rebotes pausa, y avisa con correo a administradores", async () => {
    await limitesA(50, 2);
    await supresion("bounce");
    await supresion("bounce");

    const freno = await salud();
    expect(freno.pausado).toBe(true);
    expect(freno.motivo).toMatch(/rebotes/);
    const [aviso] = await db.select().from(notificaciones).where(eq(notificaciones.tipo, "freno_dominio")).orderBy(desc(notificaciones.id)).limit(1);
    expect(aviso).toEqual(expect.objectContaining({ titulo: "Se pausaron los envíos de prospección", correoEstado: expect.stringMatching(/pendiente|enviado/) }));
  });

  it("al llegar al límite de quejas también pausa", async () => {
    await limitesA(1, 50);
    await supresion("spamreport");
    const freno = await salud();
    expect(freno.pausado).toBe(true);
    expect(freno.motivo).toMatch(/quejas/);
  });

  it("una supresión sin evento (una baja a mano) no cuenta", async () => {
    await limitesA(1, 1);
    await supresion(undefined);
    expect((await salud()).pausado).toBe(false);
  });

  it("en pausa nadie sale y nadie queda excluido: todos esperan", async () => {
    const enFila = await prospecto();
    await db.update(prospectos).set({ estado: "en_fila" }).where(eq(prospectos.id, enFila.id));
    const yaValidado = await prospecto();
    await limitesA(50, 1);
    await supresion("bounce");

    const fila = await conLlave(api().post("/api/v1/automatizacion/prospectos/fila/tomar")).send({ execution_id: randomUUID(), limite: 10 });
    expect(fila.body.data).toEqual([]);
    expect(fila.body.cupo_restante).toBe(0);

    const verificacion = await verificar(yaValidado.id);
    expect(verificacion.body).toEqual(expect.objectContaining({ puede_enviar: false, en_espera: true, motivo: "Envíos en pausa por el freno del dominio" }));

    const envio = await registrar(yaValidado.id);
    expect(envio.status).toBe(409);
    expect(envio.body.code).toBe("ENVIOS_EN_PAUSA");
    expect(await db.select().from(envios).where(eq(envios.prospectoId, yaValidado.id))).toHaveLength(0);

    const [estado] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, yaValidado.id));
    expect(estado!.estado).toBe("validado");
  });

  it("en pausa no se reclaman las ventanas vencidas: siguen abiertas para después", async () => {
    const p = await prospecto();
    const envio = await registrar(p.id);
    expect(envio.status).toBe(201);
    await db.update(envios).set({ ventanaVenceEn: new Date(Date.now() - 60_000) }).where(eq(envios.id, envio.body.id));

    await limitesA(50, 1);
    await supresion("bounce");
    const vencidas = await conLlave(api().get("/api/v1/automatizacion/envios/vencidas")).query({ limit: 50 });
    expect(vencidas.body.data).toEqual([]);
    const [fila] = await db.select({ ventanaEstado: envios.ventanaEstado }).from(envios).where(eq(envios.id, envio.body.id));
    expect(fila!.ventanaEstado).toBe("abierta");
  });

  it("un reintento de un envío ya registrado sigue funcionando en pausa", async () => {
    const p = await prospecto();
    const executionId = randomUUID();
    const body = { execution_id: executionId, prospecto_id: p.id, canal: "correo" };
    expect((await conLlave(api().post("/api/v1/automatizacion/envios")).send(body)).status).toBe(201);
    await limitesA(50, 1);
    await supresion("bounce");
    const reintento = await conLlave(api().post("/api/v1/automatizacion/envios")).send(body);
    expect(reintento.status).toBe(200);
    expect(reintento.body.ya_existia).toBe(true);
  });

  it("reanudar es solo del administrador, queda auditado, y después solo cuenta lo nuevo", async () => {
    await limitesA(50, 1);
    await supresion("bounce");
    expect((await reanudar(agenteCookie)).status).toBe(403);

    const res = await reanudar();
    expect(res.status).toBe(200);
    expect(res.body.pausado).toBe(false);
    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "freno_dominio"), eq(auditoria.accion, "reanudar"))).orderBy(desc(auditoria.id)).limit(1);
    expect(audit).toBeDefined();
    expect((await reanudar()).status).toBe(409);

    // Lo de antes de reanudar ya no cuenta: un evento más no la vuelve a pausar...
    await db.update(listaSupresion).set({ creadoEn: new Date(Date.now() - 2 * 60 * 1000) });
    const [fila] = await db.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, "freno_dominio"));
    await db.update(parametrosAutomatizacion).set({ valor: { ...(fila!.valor as object), reanudado_en: new Date(Date.now() - 60 * 1000).toISOString() } }).where(eq(parametrosAutomatizacion.clave, "freno_dominio"));
    env.FRENO_REBOTES_7D = 2;
    await supresion("bounce");
    expect((await salud()).pausado).toBe(false);
    // ...y el siguiente, que sí llega al límite, sí.
    await supresion("bounce");
    expect((await salud()).pausado).toBe(true);
  });
});
