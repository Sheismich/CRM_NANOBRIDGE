import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { prospectos, respuestas, tareas } from "../src/database/schema.js";
import { CLASIFICACIONES_N8N } from "../src/shared/clasificaciones.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Modo sugerencia (decisión del 30-sep-2026): la IA de n8n solo PROPONE una
// clasificación con su % de confianza; la respuesta sigue en la cola y una
// persona confirma. Nada (estado del prospecto, bajas, tareas) depende de
// la IA mientras tanto. POST /automatizacion/respuestas/sugerencia.
describe("sugerencia de clasificación (IA en modo sugerencia)", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  // Una respuesta como las registra PT2: con su tarea en la cola.
  async function respuestaEnCola(contenido = "¿me mandan precios?") {
    const alta = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa Sugerencia ${randomUUID()}` }, contacto: { nombre: "Persona Sugerencia", correo: `sugerencia.${randomUUID()}@sugerencia.test` } });
    expect(alta.status).toBe(201);
    const res = await api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), prospecto_id: alta.body.id, canal: "correo", contenido, crear_tarea_clasificacion: true });
    expect(res.status).toBe(201);
    return { prospectoId: alta.body.id as number, respuestaId: res.body.id as number, tareaId: res.body.tarea_id as number };
  }

  function sugerir(body: Record<string, unknown>) {
    return api().post("/api/v1/automatizacion/respuestas/sugerencia").set("X-API-Key", API_KEY).send(body);
  }

  async function fila(respuestaId: number) {
    const [r] = await db.select().from(respuestas).where(eq(respuestas.id, respuestaId));
    return r!;
  }

  async function itemDeCola(tareaId: number) {
    const cola = await api().get("/api/v1/cola-clasificacion").query({ limit: 100 }).set("Cookie", adminCookie);
    expect(cola.status).toBe(200);
    return (cola.body.data as { id: number; respuesta: Record<string, unknown> | null }[]).find((t) => t.id === tareaId);
  }

  it("el ENUM real de respuestas.clasificacion_sugerida coincide con CLASIFICACIONES_N8N", async () => {
    const [filas] = await db.execute(sql`SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'respuestas' AND COLUMN_NAME = 'clasificacion_sugerida'`);
    const tipo = (filas as unknown as { tipo: string }[])[0]!.tipo;
    expect([...tipo.matchAll(/'([^']*)'/g)].map((m) => m[1])).toEqual([...CLASIFICACIONES_N8N]);
  });

  it("guarda la sugerencia sin decidir nada: la respuesta sigue pendiente, el prospecto igual y la tarea en la cola", async () => {
    const { prospectoId, respuestaId, tareaId } = await respuestaEnCola();
    const [antes] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId));

    const res = await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 87, motivo: "pide precios" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ respuesta_id: respuestaId, clasificacion_sugerida: "interesado", confianza_sugerida: 87, ya_existia: false, sobrescrita: false });

    const r = await fila(respuestaId);
    expect(r.estado).toBe("pendiente_clasificacion");
    expect(r.clasificacion).toBeNull();
    expect(r.clasificacionSugerida).toBe("interesado");
    expect(r.confianzaSugerida).toBe(87);
    expect(r.motivoSugerencia).toBe("pide precios");
    expect(r.sugeridoEn).toBeInstanceOf(Date);

    const [despues] = await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, prospectoId));
    expect(despues!.estado).toBe(antes!.estado);
    const [tarea] = await db.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, tareaId));
    expect(tarea!.estado).toBe("pendiente");
  });

  it("la cola muestra la sugerencia de la IA, su confianza y su motivo", async () => {
    const { respuestaId, tareaId } = await respuestaEnCola();
    expect((await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "no_interesado", confianza: 64, motivo: "dice que ya tienen proveedor" })).status).toBe(201);

    expect((await itemDeCola(tareaId))!.respuesta).toMatchObject({ id: respuestaId, clasificacion_sugerida: "no_interesado", confianza_sugerida: 64, motivo_sugerencia: "dice que ya tienen proveedor" });
  });

  it("un reintento con el mismo execution_id responde ya_existia sin cambiar nada", async () => {
    const { respuestaId } = await respuestaEnCola();
    const body = { execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 90 };
    expect((await sugerir(body)).status).toBe(201);

    const segunda = await sugerir({ ...body, confianza: 10 });
    expect(segunda.status).toBe(200);
    expect(segunda.body.ya_existia).toBe(true);
    expect((await fila(respuestaId)).confianzaSugerida).toBe(90);
  });

  it("otro execution_id (se volvió a correr el workflow) sobrescribe mientras la respuesta siga sin decidir", async () => {
    const { respuestaId } = await respuestaEnCola();
    expect((await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "ambigua", confianza: 40 })).status).toBe(201);

    const res = await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 95, motivo: "segunda corrida" });
    expect(res.status).toBe(201);
    expect(res.body.sobrescrita).toBe(true);
    const r = await fila(respuestaId);
    expect(r.clasificacionSugerida).toBe("interesado");
    expect(r.confianzaSugerida).toBe(95);
    expect(r.motivoSugerencia).toBe("segunda corrida");
  });

  it("una sugerencia nueva sin motivo borra el motivo de la anterior", async () => {
    const { respuestaId } = await respuestaEnCola();
    expect((await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "ambigua", confianza: 40, motivo: "no queda claro" })).status).toBe(201);
    expect((await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 80 })).status).toBe(201);
    expect((await fila(respuestaId)).motivoSugerencia).toBeNull();
  });

  it("a una respuesta ya decidida: 409 con code RESPUESTA_YA_CLASIFICADA", async () => {
    const { respuestaId, tareaId } = await respuestaEnCola();
    expect((await api().post(`/api/v1/cola-clasificacion/${tareaId}/clasificar`).set("Cookie", adminCookie).send({ clasificacion: "no_interesado" })).status).toBe(200);

    const res = await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 99 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RESPUESTA_YA_CLASIFICADA");
    expect((await fila(respuestaId)).clasificacionSugerida).toBeNull();
  });

  it("confianza fuera de 0-100 o con decimales: 400", async () => {
    const { respuestaId } = await respuestaEnCola();
    for (const confianza of [-1, 101, 50.5]) {
      expect((await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza })).status).toBe(400);
    }
  });

  it("un motivo largo se guarda recortado a 500 caracteres en vez de rechazar la sugerencia", async () => {
    const { respuestaId } = await respuestaEnCola();
    const res = await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 70, motivo: "x".repeat(2000) });
    expect(res.status).toBe(201);
    expect((await fila(respuestaId)).motivoSugerencia).toBe("x".repeat(500));
  });

  it("un emoji justo en el carácter 500 del motivo no queda partido", async () => {
    const { respuestaId } = await respuestaEnCola();
    const res = await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "interesado", confianza: 70, motivo: `${"a".repeat(499)}😀${"b".repeat(100)}` });
    expect(res.status).toBe(201);
    expect((await fila(respuestaId)).motivoSugerencia).toBe(`${"a".repeat(499)}😀`);
  });

  it("n8n no puede sugerir los valores que solo existen en la clasificación manual", async () => {
    const { respuestaId } = await respuestaEnCola();
    expect((await sugerir({ execution_id: randomUUID(), respuesta_id: respuestaId, clasificacion: "reagendar", confianza: 50 })).status).toBe(400);
  });

  it("respuesta que no existe: 404", async () => {
    expect((await sugerir({ execution_id: randomUUID(), respuesta_id: 999_999_999, clasificacion: "interesado", confianza: 50 })).status).toBe(404);
  });

  it("sin API key: 401", async () => {
    const res = await api().post("/api/v1/automatizacion/respuestas/sugerencia").send({ execution_id: randomUUID(), respuesta_id: 1, clasificacion: "interesado", confianza: 50 });
    expect(res.status).toBe(401);
  });
});
