import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, campanas, envios, listaSupresion, mediosContacto, prospectos } from "../src/database/schema.js";
import { env } from "../src/config/env.js";
import { normalizeEmail } from "../src/shared/normalize.js";
import { diaSiguiente, fechaMx, inicioDelDiaMxSql, sumarDiasFecha } from "../src/shared/dia-habil.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Botón "Mandar a automatización" (16-oct-2026). Un prospecto del CRM nacía
// en "capturado" y nunca recibía correo: PT1 solo sabía arrancar registrando
// uno nuevo. Ahora admin/supervisor lo ponen en una fila y PT1 los toma de a
// pocos al día (NUEVOS_POR_DIA, sin pasarse de TOPE_DIARIO_CORREOS), en orden
// de llegada y solo de campañas activas. Decisiones en
// docs/planes/PLAN_N8N_DEFINITIVO.md punto 7.
describe("fila de automatización", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let supervisorCookie: string[];
  let agenteCookie: string[];
  let activa: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const hoy = fechaMx(new Date());

  async function campana(estado: "borrador" | "activa" | "pausada" | "finalizada", fechas: { fechaInicio?: string; fechaFin?: string } = {}) {
    const [c] = await db.insert(campanas).values({ nombre: `Fila ${estado} ${randomUUID().slice(0, 8)}`, canal: "correo", estado, ...fechas });
    return c.insertId;
  }

  // Prospecto como lo deja el importador del CRM: en "capturado" y sin
  // execution_id de PT1 (aquí se registra por /automatizacion por comodidad).
  async function prospecto(opts: { giro?: string | null; tamano?: "micro" | "pequena" | "mediana" | "grande" | null; correo?: string; estado?: string; campanaId?: number | null } = {}) {
    const correo = opts.correo ?? `fila.${randomUUID()}@prospeccion.test`;
    const res = await api().post("/api/v1/automatizacion/prospectos").set("X-API-Key", API_KEY).send({
      execution_id: randomUUID(),
      empresa: {
        nombreLegal: `Fila ${randomUUID().slice(0, 8)}`,
        ...(opts.giro === null ? {} : { giro: opts.giro ?? "Manufactura" }),
        ...(opts.tamano === null ? {} : { tamano: opts.tamano ?? "mediana" })
      },
      contacto: { nombre: "Persona Fila", correo }
    });
    expect(res.status).toBeLessThan(300);
    const id = res.body.id as number;
    await db.update(prospectos).set({ executionId: null, estado: opts.estado ?? "capturado", campanaId: opts.campanaId ?? null }).where(eq(prospectos.id, id));
    return { id, correo, contactoId: res.body.contacto_id as number };
  }

  async function envio(prospectoId: number, numero: number, ventana: "abierta" | "cerrada") {
    await db.insert(envios).values({
      prospectoId,
      canal: "correo",
      numeroContacto: numero,
      ventanaVenceEn: new Date(Date.now() + 3 * 86_400_000),
      ventanaEstado: ventana,
      executionId: randomUUID(),
      enviadoEn: new Date(Date.now() - (4 - numero) * 86_400_000)
    });
  }

  const mandar = (cookie: string[], prospectoIds: number[], campanaId: number) =>
    api().post("/api/v1/prospectos/automatizacion").set("Cookie", cookie).send({ prospectoIds, campanaId });

  const sacar = (cookie: string[], id: number) =>
    api().post(`/api/v1/prospectos/${id}/sacar-de-fila`).set("Cookie", cookie);

  const tomar = (executionId: string, limite = 10) =>
    api().post("/api/v1/automatizacion/prospectos/fila/tomar").set("X-API-Key", API_KEY).send({ execution_id: executionId, limite });

  async function fila(id: number) {
    const [row] = await db.select().from(prospectos).where(eq(prospectos.id, id));
    return row!;
  }

  async function ultimaAuditoria(id: number, accion: string) {
    const [row] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, id), eq(auditoria.accion, accion))).orderBy(desc(auditoria.id)).limit(1);
    return row;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `agente.fila.${randomUUID()}@test.local`);
    const correoSup = `sup.fila.${randomUUID()}@test.local`;
    expect((await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: "Supervisor Fila", correo: correoSup, password: "password_sup_fila_1", rol: "supervisor" })).status).toBe(201);
    supervisorCookie = await loginAs(app, correoSup, "password_sup_fila_1");
    activa = await campana("activa");
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("botón Mandar a automatización", () => {
    it("un agente no puede (403)", async () => {
      const p = await prospecto();
      expect((await mandar(agenteCookie, [p.id], activa)).status).toBe(403);
      expect((await fila(p.id)).estado).toBe("capturado");
    });

    it("un supervisor sí: queda en_fila con su campaña, quién y desde cuándo, y deja auditoría", async () => {
      const p = await prospecto();
      const res = await mandar(supervisorCookie, [p.id], activa);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ agregados: [p.id], cambiados: [], rechazados: [] });
      const row = await fila(p.id);
      expect(row.estado).toBe("en_fila");
      expect(row.campanaId).toBe(activa);
      expect(row.filaDesde).not.toBeNull();
      expect(row.filaPor).not.toBeNull();
      expect(row.filaTomadoEn).toBeNull();
      expect(row.filaEstadoPrevio).toBe("capturado");
      const aud = await ultimaAuditoria(p.id, "mandar_automatizacion");
      expect(aud?.antes).toEqual({ estado: "capturado", campana_id: null });
      expect(aud?.despues).toMatchObject({ estado: "en_fila", campana_id: activa });
    });

    it("una campaña finalizada, en borrador o vencida se rechaza con 409 CAMPANA_TERMINADA", async () => {
      const p = await prospecto();
      for (const c of [await campana("finalizada"), await campana("borrador"), await campana("activa", { fechaFin: sumarDiasFecha(hoy, -1) })]) {
        const res = await mandar(adminCookie, [p.id], c);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("CAMPANA_TERMINADA");
      }
      expect((await mandar(adminCookie, [p.id], 999_999_999)).status).toBe(404);
      expect((await fila(p.id)).estado).toBe("capturado");
    });

    it("una campaña pausada o que aún no empieza sí se acepta (esperan en la fila)", async () => {
      const a = await prospecto();
      const b = await prospecto();
      expect((await mandar(adminCookie, [a.id], await campana("pausada"))).body.agregados).toEqual([a.id]);
      expect((await mandar(adminCookie, [b.id], await campana("activa", { fechaInicio: sumarDiasFecha(hoy, 5) }))).body.agregados).toEqual([b.id]);
    });

    it("entran los listos y los demás regresan con su motivo", async () => {
      const listo = await prospecto();
      const sinGiro = await prospecto({ giro: null });
      const sinTamano = await prospecto({ tamano: null });
      const suprimido = await prospecto();
      await db.insert(listaSupresion).values({ tipo: "correo", valorNormalizado: normalizeEmail(suprimido.correo), motivo: "prueba fila" });
      const enBaja = await prospecto();
      await prospecto({ correo: enBaja.correo, estado: "baja" });
      const conVentana = await prospecto();
      const hermano = await prospecto({ correo: conVentana.correo, estado: "validado" });
      await envio(hermano.id, 1, "abierta");
      const tresCorreos = await prospecto();
      const otro = await prospecto({ correo: tresCorreos.correo, estado: "inactivo" });
      for (const n of [1, 2, 3]) await envio(otro.id, n, "cerrada");
      const inactivo = await prospecto({ estado: "inactivo" });
      const descartado = await prospecto({ estado: "descartado" });

      const res = await mandar(adminCookie, [listo.id, sinGiro.id, sinTamano.id, suprimido.id, enBaja.id, conVentana.id, tresCorreos.id, inactivo.id, descartado.id, 999_999_998], activa);
      expect(res.status).toBe(200);
      expect(res.body.agregados).toEqual([listo.id]);
      const motivos = Object.fromEntries(res.body.rechazados.map((r: { id: number; motivos: string[] }) => [r.id, r.motivos]));
      expect(motivos[sinGiro.id]).toEqual(["giro_no_informado"]);
      expect(motivos[sinTamano.id]).toEqual(["tamano_no_informado"]);
      expect(motivos[suprimido.id]).toEqual(["suprimido"]);
      expect(motivos[enBaja.id]).toContain("en_baja");
      expect(motivos[conVentana.id]).toEqual(["ventana_activa"]);
      expect(motivos[tresCorreos.id]).toEqual(["maximo_contactos"]);
      expect(motivos[inactivo.id]).toEqual(["estado_no_permitido"]);
      expect(motivos[descartado.id]).toEqual(["estado_no_permitido"]);
      expect(motivos[999_999_998]).toEqual(["no_encontrado"]);
      for (const p of [sinGiro, sinTamano, suprimido, enBaja, conVentana, tresCorreos]) {
        expect((await fila(p.id)).estado).toBe("capturado");
      }
    });

    it("un excluido que ya se corrigió sí entra, y se guarda que venía de excluido", async () => {
      const p = await prospecto({ estado: "excluido" });
      expect((await mandar(adminCookie, [p.id], activa)).body.agregados).toEqual([p.id]);
      expect((await fila(p.id)).filaEstadoPrevio).toBe("excluido");
    });

    it("la misma persona no entra dos veces a la fila", async () => {
      const a = await prospecto();
      const b = await prospecto({ correo: a.correo });
      const res = await mandar(adminCookie, [a.id, b.id], activa);
      expect(res.body.agregados).toEqual([a.id]);
      expect(res.body.rechazados).toEqual([{ id: b.id, motivos: ["ya_en_fila"] }]);
    });

    it("a uno que ya está en la fila solo le cambia la campaña, sin quitarle su lugar", async () => {
      const p = await prospecto();
      await mandar(adminCookie, [p.id], activa);
      const antes = await fila(p.id);
      const otra = await campana("activa");
      const res = await mandar(adminCookie, [p.id], otra);
      expect(res.body).toEqual({ agregados: [], cambiados: [p.id], rechazados: [] });
      const despues = await fila(p.id);
      expect(despues.campanaId).toBe(otra);
      expect(despues.filaDesde).toEqual(antes.filaDesde);
      const aud = await ultimaAuditoria(p.id, "cambiar_campana_fila");
      expect(aud?.antes).toEqual({ campana_id: activa });
      expect(aud?.despues).toEqual({ campana_id: otra });
    });

    it("a uno que PT1 ya tomó no se le cambia la campaña", async () => {
      const p = await prospecto();
      await mandar(adminCookie, [p.id], activa);
      await db.update(prospectos).set({ filaTomadoEn: new Date() }).where(eq(prospectos.id, p.id));
      const res = await mandar(adminCookie, [p.id], await campana("activa"));
      expect(res.body.rechazados).toEqual([{ id: p.id, motivos: ["ya_tomado"] }]);
      expect((await fila(p.id)).campanaId).toBe(activa);
    });

    it("valida el cuerpo: sin prospectos o más de 200 es 400", async () => {
      expect((await mandar(adminCookie, [], activa)).status).toBe(400);
      expect((await mandar(adminCookie, Array.from({ length: 201 }, (_, i) => i + 1), activa)).status).toBe(400);
    });
  });

  describe("sacar de la fila", () => {
    it("regresa a capturado aunque haya entrado como excluido; la campaña se queda y la auditoría dice de dónde venía", async () => {
      const p = await prospecto({ estado: "excluido" });
      await mandar(adminCookie, [p.id], activa);
      const res = await sacar(supervisorCookie, p.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: p.id, estado: "capturado" });
      const row = await fila(p.id);
      expect(row.estado).toBe("capturado");
      expect(row.campanaId).toBe(activa);
      expect(row.filaDesde).toBeNull();
      expect(row.filaEstadoPrevio).toBeNull();
      const aud = await ultimaAuditoria(p.id, "sacar_de_fila");
      expect(aud?.antes).toEqual({ estado: "en_fila", estado_previo: "excluido" });
      expect(aud?.despues).toEqual({ estado: "capturado" });
    });

    it("409 si PT1 ya lo tomó o si no está en la fila; 403 para un agente", async () => {
      const p = await prospecto();
      expect((await sacar(adminCookie, p.id)).status).toBe(409);
      await mandar(adminCookie, [p.id], activa);
      expect((await sacar(agenteCookie, p.id)).status).toBe(403);
      await db.update(prospectos).set({ filaTomadoEn: new Date() }).where(eq(prospectos.id, p.id));
      const res = await sacar(adminCookie, p.id);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("PROSPECTO_YA_TOMADO");
      expect((await sacar(adminCookie, 999_999_997)).status).toBe(404);
    });
  });

  describe("la fila en la lista y el detalle", () => {
    it("trae su lugar en la fila y la vigencia de la campaña", async () => {
      await db.update(prospectos).set({ estado: "capturado" }).where(eq(prospectos.estado, "en_fila"));
      const pausada = await campana("pausada");
      const a = await prospecto();
      const b = await prospecto();
      await mandar(adminCookie, [a.id], activa);
      await mandar(adminCookie, [b.id], pausada);
      await db.update(prospectos).set({ filaDesde: new Date(Date.now() - 60_000) }).where(eq(prospectos.id, a.id));

      const detalle = await api().get(`/api/v1/prospectos/${b.id}`).set("Cookie", adminCookie);
      expect(detalle.status).toBe(200);
      expect(detalle.body).toMatchObject({ estado: "en_fila", fila_posicion: 2, fila_tomado_en: null, campana_vigencia: "en_espera" });
      expect(detalle.body.fila_desde).not.toBeNull();

      const lista = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ estado: "en_fila", limit: 100 });
      const filaA = lista.body.data.find((p: { id: number }) => p.id === a.id);
      expect(filaA).toMatchObject({ fila_posicion: 1, campana_vigencia: "activa" });
    });

    it("un excluido trae por qué se excluyó la vez pasada", async () => {
      const p = await prospecto({ giro: null });
      await api().post("/api/v1/automatizacion/validaciones").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: p.id });
      expect((await fila(p.id)).estado).toBe("excluido");
      const detalle = await api().get(`/api/v1/prospectos/${p.id}`).set("Cookie", adminCookie);
      expect(detalle.body.motivo_exclusion_anterior).toEqual(["giro_no_informado"]);

      const q = await prospecto({ estado: "validado" });
      await api().post("/api/v1/automatizacion/prospectos/estado").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: q.id, estado: "excluido", motivo: "Ventana de espera activa" });
      const lista = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ estado: "excluido", orden: "recientes", limit: 100 });
      expect(lista.body.data.find((r: { id: number }) => r.id === q.id)?.motivo_exclusion_anterior).toEqual(["Ventana de espera activa"]);
    });
  });

  describe("PT1 toma de la fila", () => {
    const nuevosOriginal = env.NUEVOS_POR_DIA;
    const topeOriginal = env.TOPE_DIARIO_CORREOS;

    // Cada prueba arranca con la fila vacía (los archivos corren uno a la
    // vez, así que solo este archivo deja gente en_fila).
    beforeEach(async () => {
      await db.update(prospectos).set({ estado: "capturado" }).where(eq(prospectos.estado, "en_fila"));
    });

    afterEach(() => {
      env.NUEVOS_POR_DIA = nuevosOriginal;
      env.TOPE_DIARIO_CORREOS = topeOriginal;
    });

    async function tomadosHoy() {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(prospectos).where(and(
        gte(prospectos.filaTomadoEn, sql`${inicioDelDiaMxSql(hoy)}`),
        lt(prospectos.filaTomadoEn, sql`${inicioDelDiaMxSql(diaSiguiente(hoy))}`)
      ));
      return Number(row!.n);
    }

    async function correosDeHoy() {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(envios).where(and(
        eq(envios.canal, "correo"),
        gte(envios.enviadoEn, sql`${inicioDelDiaMxSql(hoy)}`),
        lt(envios.enviadoEn, sql`${inicioDelDiaMxSql(diaSiguiente(hoy))}`)
      ));
      return Number(row!.n);
    }

    it("sin X-API-Key es 401", async () => {
      expect((await api().post("/api/v1/automatizacion/prospectos/fila/tomar").send({ execution_id: randomUUID() })).status).toBe(401);
    });

    it("entrega en orden de llegada, con lo que PT1 necesita para el correo, y los marca tomados", async () => {
      const a = await prospecto();
      const b = await prospecto();
      const c = await prospecto();
      await mandar(adminCookie, [a.id, b.id, c.id], activa);
      await db.update(prospectos).set({ filaDesde: new Date(Date.now() - 120_000) }).where(eq(prospectos.id, c.id));
      // El score de PT1 suma por tamaño, región y teléfono: van en la respuesta.
      await db.insert(mediosContacto).values({ contactoId: c.contactoId, tipo: "telefono", valor: "449 123 4567", valorNormalizado: "4491234567" });

      const exec = randomUUID();
      const res = await tomar(exec, 2);
      expect(res.status).toBe(200);
      expect(res.body.data.map((d: { prospecto_id: number }) => d.prospecto_id)).toEqual([c.id, a.id]);
      expect(res.body.data[0]).toMatchObject({ prospecto_id: c.id, campana_id: activa, correo: c.correo, contacto_nombre: "Persona Fila", giro: "Manufactura", tamano: "mediana", region: null, telefono: "449 123 4567" });
      expect(res.body.data[1]).toMatchObject({ prospecto_id: a.id, telefono: null });
      expect(res.body.data[0].empresa_nombre).toMatch(/^Fila /);
      expect(res.body.tope_diario_alcanzado).toBe(false);

      const tomado = await fila(c.id);
      expect(tomado.estado).toBe("en_fila");
      expect(tomado.filaTomadoEn).not.toBeNull();
      expect(tomado.filaExecutionId).toBe(exec);
      expect((await fila(b.id)).filaTomadoEn).toBeNull();
      expect(await ultimaAuditoria(c.id, "tomar_de_fila")).toBeDefined();
    });

    it("la misma ejecución recibe los mismos (reintento de n8n) y no toma más", async () => {
      const a = await prospecto();
      const b = await prospecto();
      await mandar(adminCookie, [a.id, b.id], activa);
      const exec = randomUUID();
      const primera = await tomar(exec, 1);
      const segunda = await tomar(exec, 1);
      expect(segunda.body.data.map((d: { prospecto_id: number }) => d.prospecto_id)).toEqual(primera.body.data.map((d: { prospecto_id: number }) => d.prospecto_id));
      expect((await fila(b.id)).filaTomadoEn).toBeNull();
    });

    it("no pasa de NUEVOS_POR_DIA en el día, aunque PT1 corra dos veces", async () => {
      const ps = [await prospecto(), await prospecto(), await prospecto()];
      await mandar(adminCookie, ps.map((p) => p.id), activa);
      env.NUEVOS_POR_DIA = (await tomadosHoy()) + 2;
      expect((await tomar(randomUUID(), 10)).body.data).toHaveLength(2);
      const otra = await tomar(randomUUID(), 10);
      expect(otra.body.data).toHaveLength(0);
      expect(otra.body.cupo_restante).toBe(0);
    });

    it("no pasa del tope diario de correos (los recordatorios ya enviados cuentan)", async () => {
      const ps = [await prospecto(), await prospecto()];
      await mandar(adminCookie, ps.map((p) => p.id), activa);
      env.TOPE_DIARIO_CORREOS = (await correosDeHoy()) + 1;
      expect((await tomar(randomUUID(), 10)).body.data).toHaveLength(1);
      env.TOPE_DIARIO_CORREOS = await correosDeHoy();
      const lleno = await tomar(randomUUID(), 10);
      expect(lleno.body.data).toHaveLength(0);
      expect(lleno.body.tope_diario_alcanzado).toBe(true);
    });

    it("se salta a los de campañas pausadas, que aún no empiezan o terminadas; salen cuando la campaña se reanuda", async () => {
      const pausada = await campana("pausada");
      const futura = await campana("activa", { fechaInicio: sumarDiasFecha(hoy, 3) });
      const terminara = await campana("activa");
      const p1 = await prospecto();
      const p2 = await prospecto();
      const p3 = await prospecto();
      await mandar(adminCookie, [p1.id], pausada);
      await mandar(adminCookie, [p2.id], futura);
      await mandar(adminCookie, [p3.id], terminara);
      await db.update(campanas).set({ estado: "finalizada" }).where(eq(campanas.id, terminara));

      expect((await tomar(randomUUID())).body.data).toHaveLength(0);
      expect((await fila(p3.id)).estado).toBe("en_fila");

      await db.update(campanas).set({ estado: "activa" }).where(eq(campanas.id, pausada));
      expect((await tomar(randomUUID())).body.data.map((d: { prospecto_id: number }) => d.prospecto_id)).toEqual([p1.id]);
    });

    // En feriado PT1 corre igual (n8n no conoce los feriados), pero no se le
    // da a nadie: esperan su lugar para el siguiente día hábil (29-oct-2026).
    it("en feriado no entrega a nadie y no los marca tomados", async () => {
      const p = await prospecto();
      await mandar(adminCookie, [p.id], activa);
      vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-16T16:00:00Z") });
      try {
        const res = await tomar(randomUUID());
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ data: [], cupo_restante: 0, tope_diario_alcanzado: false });
      } finally {
        vi.useRealTimers();
      }
      expect((await fila(p.id)).filaTomadoEn).toBeNull();
      await sacar(adminCookie, p.id);
    });

    it("uno tomado que en 24 h no avanzó se vuelve a poder tomar", async () => {
      const p = await prospecto();
      await mandar(adminCookie, [p.id], activa);
      await tomar(randomUUID());
      expect((await tomar(randomUUID())).body.data).toHaveLength(0);
      await db.update(prospectos).set({ filaTomadoEn: new Date(Date.now() - 25 * 3_600_000) }).where(eq(prospectos.id, p.id));
      expect((await tomar(randomUUID())).body.data.map((d: { prospecto_id: number }) => d.prospecto_id)).toEqual([p.id]);
    });

    it("dos llamadas a la vez no toman al mismo prospecto", async () => {
      const ps = [await prospecto(), await prospecto(), await prospecto(), await prospecto()];
      await mandar(adminCookie, ps.map((p) => p.id), activa);
      const [r1, r2] = await Promise.all([tomar(randomUUID(), 3), tomar(randomUUID(), 3)]);
      const ids = [...r1.body.data, ...r2.body.data].map((d: { prospecto_id: number }) => d.prospecto_id);
      expect(ids).toHaveLength(4);
      expect(new Set(ids).size).toBe(4);
    });

    it("después de tomarlo, la validación de siempre lo saca de en_fila", async () => {
      const p = await prospecto();
      await mandar(adminCookie, [p.id], activa);
      await tomar(randomUUID());
      const val = await api().post("/api/v1/automatizacion/validaciones").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), prospecto_id: p.id });
      expect(val.body).toMatchObject({ valido: true, estado: "validado" });
      expect((await fila(p.id)).estado).toBe("validado");
    });
  });
});
