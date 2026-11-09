import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { auditoria, campanas, envios, prospectos } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Una persona en varias campañas (9-nov-2026). Los contactos de Carlos van a
// dos campañas de servicios distintos (agua y tratamiento de maquinaria).
// Decisiones de Fabián:
// - Los 3 correos y los 6 meses de un "no interesado" se cuentan por persona
//   Y campaña: los 3 de agua no gastan los de maquinaria.
// - Una serie a la vez: la de maquinaria no arranca mientras la de agua está
//   en curso, y arranca en cuanto termina.
// - "Me interesa" en una campaña frena las demás (lo atiende el vendedor).
// - La baja sigue siendo de la persona (no cambia, ver 245-baja-por-evento).
describe("una persona en varias campañas", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agua: number;
  let maquinaria: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  async function campana(nombre: string) {
    const [c] = await db.insert(campanas).values({ nombre: `${nombre} ${randomUUID().slice(0, 8)}`, canal: "correo", estado: "activa" });
    return c.insertId;
  }

  // Un prospecto de la persona (mismo correo = misma persona) en una campaña.
  async function prospecto(correo: string, campanaId: number | null, estado = "validado") {
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Campañas ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona Campañas", correo }
    });
    expect(res.status).toBeLessThan(300);
    const id = res.body.id as number;
    await db.update(prospectos).set({ campanaId, estado, executionId: null }).where(eq(prospectos.id, id));
    return id;
  }

  async function sembrarEnvio(prospectoId: number, numeroContacto: number, diasAtras: number, ventanaEstado: "abierta" | "vencida" | "cerrada") {
    const enviadoEn = new Date(Date.now() - diasAtras * 86_400_000);
    const [r] = await db.insert(envios).values({ prospectoId, canal: "correo", numeroContacto, ventanaEstado, ventanaVenceEn: new Date(enviadoEn.getTime() + 7 * 86_400_000), executionId: randomUUID(), enviadoEn, estado: "enviado" });
    return r.insertId;
  }

  const persona = () => `campanas.${randomUUID()}@destino.test`;
  const verificar = (id: number) => conLlave(api().get("/api/v1/automatizacion/envios/verificacion")).query({ prospecto_id: id, canal: "correo" });
  const enviar = (id: number) => conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: randomUUID(), prospecto_id: id, canal: "correo" });
  const mandar = (prospectoIds: number[], campanaId: number, modo?: "agregar" | "cambiar") =>
    api().post("/api/v1/prospectos/automatizacion").set("Cookie", adminCookie).send({ prospectoIds, campanaId, ...(modo ? { modo } : {}) });
  const tomar = () => conLlave(api().post("/api/v1/automatizacion/prospectos/fila/tomar")).send({ execution_id: randomUUID(), limite: 50 });

  async function estado(id: number) {
    const [row] = await db.select().from(prospectos).where(eq(prospectos.id, id));
    return row!;
  }

  async function clasificar(prospectoId: number, clasificacion: "interesado" | "no_interesado") {
    const r = await conLlave(api().post("/api/v1/automatizacion/respuestas")).send({ execution_id: randomUUID(), prospecto_id: prospectoId, canal: "correo", contenido: "Respuesta de prueba" });
    expect(r.status).toBe(201);
    const c = await conLlave(api().post("/api/v1/automatizacion/respuestas/clasificacion")).send({ execution_id: randomUUID(), respuesta_id: r.body.id, clasificacion });
    expect(c.status).toBeLessThan(300);
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agua = await campana("Agua");
    maquinaria = await campana("Maquinaria");
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("los 3 correos se cuentan por campaña", () => {
    it("los 3 de agua (ya terminada) no gastan los de maquinaria", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua, "inactivo");
      for (const [n, dias] of [[1, 30], [2, 20], [3, 10]] as const) await sembrarEnvio(enAgua, n, dias, "vencida");
      const enMaquinaria = await prospecto(correo, maquinaria);

      const v = await verificar(enMaquinaria);
      expect(v.body).toMatchObject({ puede_enviar: true, numero_en_ciclo_siguiente: 1 });
      const envio = await enviar(enMaquinaria);
      expect(envio.status).toBe(201);
      expect(envio.body.numero_en_ciclo).toBe(1);
    });

    it("dentro de la misma campaña, un reingreso sigue contando", async () => {
      const correo = persona();
      const primero = await prospecto(correo, agua, "inactivo");
      await sembrarEnvio(primero, 1, 20, "vencida");
      await sembrarEnvio(primero, 2, 10, "vencida");
      const reingreso = await prospecto(correo, agua);
      expect((await verificar(reingreso)).body).toMatchObject({ puede_enviar: true, numero_en_ciclo_siguiente: 3 });
    });
  });

  describe("una serie a la vez", () => {
    it("maquinaria no arranca mientras la serie de agua está en curso", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      await sembrarEnvio(enAgua, 1, 2, "abierta");
      const enMaquinaria = await prospecto(correo, maquinaria);

      const v = await verificar(enMaquinaria);
      expect(v.body).toMatchObject({ puede_enviar: false, motivo: "Otra campaña con esta persona sigue en curso" });
      const envio = await enviar(enMaquinaria);
      expect(envio.status).toBe(409);
      expect(envio.body.code).toBe("OTRA_CAMPANA_EN_CURSO");
      expect(await db.select().from(envios).where(eq(envios.prospectoId, enMaquinaria))).toHaveLength(0);
    });

    it("en cuanto agua termina, maquinaria ya puede arrancar", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      await sembrarEnvio(enAgua, 1, 2, "vencida");
      const enMaquinaria = await prospecto(correo, maquinaria);
      expect((await verificar(enMaquinaria)).body.puede_enviar).toBe(false);

      await db.update(prospectos).set({ estado: "inactivo" }).where(eq(prospectos.id, enAgua));
      expect((await verificar(enMaquinaria)).body.puede_enviar).toBe(true);
    });

    it("un envío fallido no cuenta como serie en curso", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      const fallido = await sembrarEnvio(enAgua, 1, 1, "cerrada");
      await db.update(envios).set({ estado: "fallido" }).where(eq(envios.id, fallido));
      const enMaquinaria = await prospecto(correo, maquinaria);
      expect((await verificar(enMaquinaria)).body.puede_enviar).toBe(true);
    });
  });

  describe("no interesado", () => {
    it("un 'no' en agua solo frena agua: maquinaria sí le escribe", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      await sembrarEnvio(enAgua, 1, 3, "abierta");
      await clasificar(enAgua, "no_interesado");
      expect((await estado(enAgua)).estado).toBe("no_interesado");

      const enMaquinaria = await prospecto(correo, maquinaria);
      expect((await verificar(enMaquinaria)).body.puede_enviar).toBe(true);
      const otraVezAgua = await prospecto(correo, agua);
      expect((await verificar(otraVezAgua)).body).toMatchObject({ puede_enviar: false, motivo: "Respondió que no le interesa; hay que esperar 6 meses" });
    });
  });

  describe("interesado", () => {
    it("un 'me interesa' en agua saca de la fila a maquinaria y ya no lo deja entrar", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      await sembrarEnvio(enAgua, 1, 3, "abierta");
      const enMaquinaria = await prospecto(correo, maquinaria, "capturado");
      expect((await mandar([enMaquinaria], maquinaria)).body.agregados).toEqual([enMaquinaria]);
      expect((await estado(enMaquinaria)).estado).toBe("en_fila");

      await clasificar(enAgua, "interesado");
      const despues = await estado(enMaquinaria);
      expect(despues.estado).toBe("capturado");
      expect(despues.filaDesde).toBeNull();
      const [aud] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, enMaquinaria), eq(auditoria.accion, "sacar_de_fila"))).orderBy(desc(auditoria.id)).limit(1);
      expect(aud?.despues).toMatchObject({ estado: "capturado", motivo: `Le interesó otra campaña (prospecto ${enAgua})` });

      const otraVez = await mandar([enMaquinaria], maquinaria);
      expect(otraVez.body.rechazados).toEqual([{ id: enMaquinaria, motivos: ["interesado_en_otra_campana"] }]);
      expect((await verificar(enMaquinaria)).body).toMatchObject({ puede_enviar: false, motivo: "Le interesó otra campaña; lo atiende un vendedor" });
    });

    it("si la serie de maquinaria ya iba y llega tarde un 'me interesa' de agua, PT4 ya no le manda el recordatorio", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua, "inactivo");
      await sembrarEnvio(enAgua, 1, 40, "vencida");
      const enMaquinaria = await prospecto(correo, maquinaria);
      const envioMaquinaria = await sembrarEnvio(enMaquinaria, 1, 10, "abierta");
      await db.update(prospectos).set({ estado: "interesado" }).where(eq(prospectos.id, enAgua));

      const res = await conLlave(api().get("/api/v1/automatizacion/envios/vencidas")).query({ limit: 200 });
      expect(res.body.data.some((f: { envio_id: number }) => f.envio_id === envioMaquinaria)).toBe(false);
      expect(res.body.omitidas).toContainEqual({ envio_id: envioMaquinaria, prospecto_id: enMaquinaria, motivo: "interesado_en_otra_campana" });
    });
  });

  describe("una respuesta cierra las ventanas de su campaña", () => {
    it("una respuesta tardía a agua no cierra la ventana de maquinaria", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua, "inactivo");
      await sembrarEnvio(enAgua, 1, 40, "vencida");
      const enMaquinaria = await prospecto(correo, maquinaria);
      const envioMaquinaria = await sembrarEnvio(enMaquinaria, 1, 1, "abierta");

      const r = await conLlave(api().post("/api/v1/automatizacion/respuestas")).send({ execution_id: randomUUID(), prospecto_id: enAgua, canal: "correo", contenido: "Perdón la tardanza" });
      expect(r.status).toBe(201);
      const [envio] = await db.select().from(envios).where(eq(envios.id, envioMaquinaria));
      expect(envio!.ventanaEstado).toBe("abierta");
    });
  });

  describe("la fila", () => {
    // Otras pruebas dejan gente en la fila de la base compartida.
    beforeEach(async () => {
      await db.update(prospectos).set({ estado: "capturado" }).where(eq(prospectos.estado, "en_fila"));
    });

    it("con la misma persona en la fila de las dos, PT1 toma solo la que entró primero", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua, "capturado");
      const enMaquinaria = await prospecto(correo, maquinaria, "capturado");
      await mandar([enAgua], agua);
      await mandar([enMaquinaria], maquinaria);
      await db.update(prospectos).set({ filaDesde: new Date(Date.now() - 60_000) }).where(eq(prospectos.id, enAgua));

      const res = await tomar();
      const ids = res.body.data.map((f: { prospecto_id: number }) => f.prospecto_id);
      expect(ids).toContain(enAgua);
      expect(ids).not.toContain(enMaquinaria);
      expect((await estado(enMaquinaria)).filaTomadoEn).toBeNull();
    });

    it("con la serie de agua en curso, maquinaria espera en la fila sin perder su lugar", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      await sembrarEnvio(enAgua, 1, 2, "abierta");
      const enMaquinaria = await prospecto(correo, maquinaria, "capturado");
      expect((await mandar([enMaquinaria], maquinaria)).body.agregados).toEqual([enMaquinaria]);

      const res = await tomar();
      expect(res.body.data.map((f: { prospecto_id: number }) => f.prospecto_id)).not.toContain(enMaquinaria);
      const row = await estado(enMaquinaria);
      expect(row.estado).toBe("en_fila");
      expect(row.filaTomadoEn).toBeNull();

      await db.update(prospectos).set({ estado: "inactivo" }).where(eq(prospectos.id, enAgua));
      expect((await tomar()).body.data.map((f: { prospecto_id: number }) => f.prospecto_id)).toContain(enMaquinaria);
    });
  });

  describe("Mandar a automatización con otra campaña", () => {
    beforeEach(async () => {
      await db.update(prospectos).set({ estado: "capturado" }).where(eq(prospectos.estado, "en_fila"));
    });

    async function hermanos(contactoDe: number) {
      const [p] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, contactoDe));
      return db.select().from(prospectos).where(eq(prospectos.contactoId, p!.contactoId));
    }

    it("en la fila de agua: 'agregar' la deja también en maquinaria (otro prospecto) y agua no cambia", async () => {
      const enAgua = await prospecto(persona(), agua, "capturado");
      await mandar([enAgua], agua);

      const res = await mandar([enAgua], maquinaria, "agregar");
      expect(res.status).toBe(200);
      expect(res.body.agregados).toEqual([enAgua]);
      expect(res.body.cambiados).toEqual([]);
      expect(res.body.nuevos).toHaveLength(1);
      expect(res.body.nuevos[0].desde).toBe(enAgua);

      const nuevo = await estado(res.body.nuevos[0].id);
      expect(nuevo).toMatchObject({ estado: "en_fila", campanaId: maquinaria, contactoId: (await estado(enAgua)).contactoId });
      expect(nuevo.filaDesde).not.toBeNull();
      expect((await estado(enAgua))).toMatchObject({ estado: "en_fila", campanaId: agua });
      const [aud] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, nuevo.id), eq(auditoria.accion, "agregar_a_campana")));
      expect(aud?.despues).toMatchObject({ estado: "en_fila", campana_id: maquinaria, desde_prospecto: enAgua });
    });

    it("en la fila de agua: 'cambiar' (o sin modo) la pasa a maquinaria, como antes", async () => {
      const enAgua = await prospecto(persona(), agua, "capturado");
      await mandar([enAgua], agua);
      const res = await mandar([enAgua], maquinaria, "cambiar");
      expect(res.body).toMatchObject({ agregados: [], cambiados: [enAgua] });
      expect((await estado(enAgua)).campanaId).toBe(maquinaria);
      expect(await hermanos(enAgua)).toHaveLength(1);
    });

    it("con la serie de agua en curso, mandarla a maquinaria crea su prospecto y espera en la fila", async () => {
      const enAgua = await prospecto(persona(), agua);
      await sembrarEnvio(enAgua, 1, 2, "abierta");
      const res = await mandar([enAgua], maquinaria);
      expect(res.body.agregados).toEqual([enAgua]);
      const nuevo = await estado(res.body.nuevos[0].id);
      expect(nuevo).toMatchObject({ estado: "en_fila", campanaId: maquinaria });
      expect((await estado(enAgua)).estado).toBe("validado");
    });

    it("si la persona ya tiene un prospecto abierto en maquinaria, no se crea otro", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua);
      await sembrarEnvio(enAgua, 1, 2, "abierta");
      await prospecto(correo, maquinaria, "capturado");
      const res = await mandar([enAgua], maquinaria);
      expect(res.body.rechazados).toEqual([{ id: enAgua, motivos: ["ya_en_esta_campana"] }]);
      expect(await hermanos(enAgua)).toHaveLength(2);
    });

    it("una persona que terminó agua sin contestar sí entra a maquinaria", async () => {
      const enAgua = await prospecto(persona(), agua, "inactivo");
      for (const [n, dias] of [[1, 30], [2, 20], [3, 10]] as const) await sembrarEnvio(enAgua, n, dias, "vencida");
      const res = await mandar([enAgua], maquinaria);
      expect(res.body.agregados).toEqual([enAgua]);
      // Pero a agua otra vez no: es el mismo prospecto, ya terminó.
      expect((await mandar([enAgua], agua)).body.rechazados).toEqual([{ id: enAgua, motivos: ["estado_no_permitido"] }]);
    });

    it("un descartado (persona o correo equivocado) no entra a otra campaña", async () => {
      const enAgua = await prospecto(persona(), agua, "descartado");
      expect((await mandar([enAgua], maquinaria)).body.rechazados).toEqual([{ id: enAgua, motivos: ["estado_no_permitido"] }]);
      expect(await hermanos(enAgua)).toHaveLength(1);
    });

    it("quien pidió la baja no entra a ninguna campaña", async () => {
      const correo = persona();
      const enAgua = await prospecto(correo, agua, "baja");
      const res = await mandar([enAgua], maquinaria);
      expect(res.body.agregados).toEqual([]);
      expect(res.body.rechazados[0].motivos).toContain("en_baja");
      expect(await hermanos(enAgua)).toHaveLength(1);
    });

    it("en la misma campaña no entra dos veces", async () => {
      const correo = persona();
      const a = await prospecto(correo, null, "capturado");
      const b = await prospecto(correo, null, "capturado");
      const res = await mandar([a, b], agua);
      expect(res.body.agregados).toEqual([a]);
      expect(res.body.rechazados).toEqual([{ id: b, motivos: ["ya_en_fila"] }]);
    });
  });
});
