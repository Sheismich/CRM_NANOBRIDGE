import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { campanas, envios, prospectos, respuestas } from "../src/database/schema.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Decisión de Carlos (4-nov-2026): a quien contestó que no le interesa se le
// puede volver a escribir, pero hasta 6 meses después de su respuesta. Puede
// volver a entrar a prospección; lo que espera es el correo.
describe("no interesado: 6 meses de espera desde su respuesta", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  function haceMeses(meses: number) {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() - meses);
    return fecha;
  }

  async function registrar(correo: string) {
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Seis meses ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona", correo }
    });
    expect(res.status).toBeLessThan(300);
    return res.body.id as number;
  }

  const verificar = (id: number) => conLlave(api().get("/api/v1/automatizacion/envios/verificacion")).query({ prospecto_id: id, canal: "correo" });
  const enviar = (id: number) => conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: randomUUID(), prospecto_id: id, canal: "correo" });

  // El prospecto que contestó, y el nuevo de la misma persona, listo para correo.
  async function personaQueDijoNo(recibidoEn: Date) {
    const correo = `seis.${randomUUID()}@destino.test`;
    const anterior = await registrar(correo);
    await db.update(prospectos).set({ estado: "no_interesado" }).where(eq(prospectos.id, anterior));
    await db.insert(respuestas).values({ prospectoId: anterior, estado: "clasificada", clasificacion: "no_interesado", recibidoEn, clasificadoEn: recibidoEn });
    const nuevo = await registrar(correo);
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, nuevo));
    return { anterior, nuevo, correo };
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("antes de 6 meses no sale el correo, y PT1 no lo deja esperando en la fila", async () => {
    const { nuevo } = await personaQueDijoNo(haceMeses(5));

    const verificacion = await verificar(nuevo);
    expect(verificacion.body).toEqual(expect.objectContaining({ puede_enviar: false, en_espera: false, motivo: "Respondió que no le interesa; hay que esperar 6 meses" }));

    const envio = await enviar(nuevo);
    expect(envio.status).toBe(409);
    expect(envio.body.code).toBe("NO_INTERESADO_RECIENTE");
    expect(await db.select().from(envios).where(eq(envios.prospectoId, nuevo))).toHaveLength(0);
  });

  it("pasados los 6 meses ya se le puede escribir", async () => {
    const { nuevo } = await personaQueDijoNo(haceMeses(7));
    expect((await verificar(nuevo)).body.puede_enviar).toBe(true);
    expect((await enviar(nuevo)).status).toBe(201);
  });

  it("los 6 meses se cuentan desde su última respuesta", async () => {
    const { anterior, nuevo } = await personaQueDijoNo(haceMeses(7));
    await db.insert(respuestas).values({ prospectoId: anterior, estado: "clasificada", clasificacion: "no_interesado", recibidoEn: haceMeses(1) });
    expect((await verificar(nuevo)).body.puede_enviar).toBe(false);
  });

  it("si la respuesta se corrigió a interesado, no hay espera", async () => {
    const { anterior, nuevo } = await personaQueDijoNo(haceMeses(1));
    await db.update(respuestas).set({ clasificacion: "interesado" }).where(eq(respuestas.prospectoId, anterior));
    await db.update(prospectos).set({ estado: "interesado" }).where(eq(prospectos.id, anterior));
    expect((await verificar(nuevo)).body.puede_enviar).toBe(true);
  });

  it("el botón Mandar a automatización lo dice en el momento", async () => {
    const { nuevo } = await personaQueDijoNo(haceMeses(2));
    await db.update(prospectos).set({ estado: "capturado", executionId: null }).where(eq(prospectos.id, nuevo));
    const [campana] = await db.insert(campanas).values({ nombre: `Seis meses ${randomUUID().slice(0, 8)}`, canal: "correo", estado: "activa" });

    const res = await api().post("/api/v1/prospectos/automatizacion").set("Cookie", adminCookie).send({ prospectoIds: [nuevo], campanaId: campana.insertId });
    expect(res.status).toBe(200);
    expect(res.body.agregados).toEqual([]);
    expect(res.body.rechazados).toEqual([expect.objectContaining({ id: nuevo, motivos: ["no_interesado_reciente"] })]);
  });

  it("otro prospecto abierto de la misma persona no recibe su recordatorio", async () => {
    const correo = `seis.${randomUUID()}@destino.test`;
    const abierto = await registrar(correo);
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, abierto));
    const envio = await enviar(abierto);
    expect(envio.status).toBe(201);

    const contesto = await registrar(correo);
    await db.update(prospectos).set({ estado: "no_interesado" }).where(eq(prospectos.id, contesto));
    await db.insert(respuestas).values({ prospectoId: contesto, estado: "clasificada", clasificacion: "no_interesado", recibidoEn: new Date() });
    await db.update(envios).set({ ventanaVenceEn: new Date("2020-01-01T12:00:00Z") }).where(eq(envios.id, envio.body.id));

    const res = await conLlave(api().get("/api/v1/automatizacion/envios/vencidas")).query({ limit: 200 });
    expect(res.body.data.some((f: { envio_id: number }) => f.envio_id === envio.body.id)).toBe(false);
    expect(res.body.omitidas).toContainEqual({ envio_id: envio.body.id, prospecto_id: abierto, motivo: "no_interesado_reciente" });
  });
});
