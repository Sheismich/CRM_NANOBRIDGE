import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { envios } from "../src/database/schema.js";
import { env } from "../src/config/env.js";
import { diaSiguiente, fechaMx, inicioDelDiaMxSql } from "../src/shared/dia-habil.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Tope diario de correos (bloque "antes de encender", decidido por Fabián el
// 5-oct-2026: 50 al día, iniciales y recordatorios juntos). Por ahora:
// - /envios/vencidas solo entrega los recordatorios que caben en el día; los
//   demás se quedan con su ventana abierta y salen otro día.
// - /envios/verificacion responde en_espera=true para que PT1 no marque
//   "excluido" a quien solo esperaba turno.
// La suite corre con TOPE_DIARIO_CORREOS muy alto (setup-env.ts) para no
// estorbarle a los demás archivos; aquí se baja a mano al número de correos
// que ya salieron hoy.
describe("tope diario de correos", () => {
  let app: INestApplication;
  const db = testDb();
  const topeOriginal = env.TOPE_DIARIO_CORREOS;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterEach(() => {
    env.TOPE_DIARIO_CORREOS = topeOriginal;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function correosDeHoy() {
    const hoy = fechaMx(new Date());
    const [fila] = await db.select({ n: sql<number>`COUNT(*)` }).from(envios).where(and(
      eq(envios.canal, "correo"),
      gte(envios.enviadoEn, sql`${inicioDelDiaMxSql(hoy)}`),
      lt(envios.enviadoEn, sql`${inicioDelDiaMxSql(diaSiguiente(hoy))}`)
    ));
    return Number(fila!.n);
  }

  async function prospectoConEnvio() {
    const prospecto = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Tope ${randomUUID()}` }, contacto: { nombre: "Persona Tope", correo: `tope.${randomUUID()}@tope.test` } });
    const envio = await api()
      .post("/api/v1/automatizacion/envios")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: prospecto.body.id, canal: "correo" });
    expect(envio.status).toBe(201);
    return { prospectoId: prospecto.body.id as number, envioId: envio.body.id as number };
  }

  async function ventana(envioId: number) {
    const [fila] = await db.select({ ventanaEstado: envios.ventanaEstado }).from(envios).where(eq(envios.id, envioId));
    return fila!.ventanaEstado;
  }

  it("verificación: con el tope lleno responde puede_enviar=false y en_espera=true (no es exclusión)", async () => {
    const prospecto = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Tope ${randomUUID()}` }, contacto: { nombre: "Persona Tope", correo: `tope.${randomUUID()}@tope.test` } });
    // Al menos un correo hoy, y el tope justo en lo que ya salió: lleno.
    await prospectoConEnvio();
    env.TOPE_DIARIO_CORREOS = await correosDeHoy();

    const res = await api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: prospecto.body.id, canal: "correo" });
    expect(res.body).toMatchObject({ puede_enviar: false, en_espera: true });

    // Con lugar, pasa como siempre.
    env.TOPE_DIARIO_CORREOS = topeOriginal;
    const conLugar = await api().get("/api/v1/automatizacion/envios/verificacion").set("X-API-Key", API_KEY).query({ prospecto_id: prospecto.body.id, canal: "correo" });
    expect(conLugar.body).toMatchObject({ puede_enviar: true, en_espera: false });
  });

  it("recordatorios: solo salen los que caben hoy; los demás se quedan abiertos para otro día", async () => {
    const a = await prospectoConEnvio();
    const b = await prospectoConEnvio();
    // Las dos ventanas ya vencieron; las de otros archivos que también
    // estuvieran por salir se sacan de turno para que no ocupen el lugar.
    await db.update(envios).set({ ventanaVenceEn: new Date("2100-01-01T00:00:00Z") })
      .where(and(eq(envios.ventanaEstado, "abierta"), lte(envios.ventanaVenceEn, sql`CURRENT_TIMESTAMP`), notInArray(envios.id, [a.envioId, b.envioId])));
    await db.update(envios).set({ ventanaVenceEn: new Date(0) }).where(inArray(envios.id, [a.envioId, b.envioId]));

    // Lugar para uno solo.
    env.TOPE_DIARIO_CORREOS = (await correosDeHoy()) + 1;
    const res = await api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.tope_diario_alcanzado).toBe(true);
    const entregado = res.body.data[0].envio_id as number;
    const otro = entregado === a.envioId ? b.envioId : a.envioId;
    expect(await ventana(entregado)).toBe("vencida");
    expect(await ventana(otro)).toBe("abierta");

    // Sin lugar: no entrega ni reclama nada.
    env.TOPE_DIARIO_CORREOS = await correosDeHoy();
    const lleno = await api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY);
    expect(lleno.body.data).toHaveLength(0);
    expect(lleno.body.tope_diario_alcanzado).toBe(true);
    expect(await ventana(otro)).toBe("abierta");

    // Al día siguiente (con lugar otra vez) sale.
    env.TOPE_DIARIO_CORREOS = topeOriginal;
    const despues = await api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY);
    expect(despues.body.data.map((d: { envio_id: number }) => d.envio_id)).toContain(otro);
    expect(despues.body.tope_diario_alcanzado).toBe(false);
  });
});
