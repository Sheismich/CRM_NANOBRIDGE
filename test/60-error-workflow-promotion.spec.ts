import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { incidencias } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Cubre AutomatizacionService.registrarErrorWorkflow() (automatizacion.service.ts):
// idempotente por (execution_id, tipo) vía el UNIQUE de incidencias, con la
// "promoción" agregada en code-review del 14-sep-2026 -- un segundo reporte
// para el MISMO execution_id que llega marcado crítico, cuando el primero
// no lo estaba, no debe perderse en silencio: debe crear la fila en
// procesos_fallidos que faltaba y subir la severidad de la incidencia ya
// existente, en vez de devolver simplemente "ya existía" sin generar el
// triage que un reporte crítico exige.
describe("POST /automatizacion/errores-workflow: idempotencia y promoción", () => {
  let app: INestApplication;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  function reportar(body: Record<string, unknown>) {
    return request(app.getHttpServer()).post("/api/v1/automatizacion/errores-workflow").set("X-API-Key", API_KEY).send(body);
  }

  it("un execution_id ya crítico desde el primer reporte crea proceso_fallido de inmediato, y un reintento idéntico no duplica la fila", async () => {
    const executionId = randomUUID();

    const primero = await reportar({ execution_id: executionId, mensaje: "fallo crítico inicial", critico: true });
    expect(primero.status).toBe(201);
    expect(primero.body.ya_existia).toBe(false);
    expect(primero.body.proceso_fallido_id).not.toBeNull();

    // Reintento idéntico (ej. n8n reintentando la misma llamada) -- mismo
    // proceso_fallido, no uno nuevo.
    const reintento = await reportar({ execution_id: executionId, mensaje: "fallo crítico inicial", critico: true });
    expect(reintento.status).toBe(200);
    expect(reintento.body.ya_existia).toBe(true);
    expect(reintento.body.proceso_fallido_id).toBe(primero.body.proceso_fallido_id);
  });

  it("dos reportes NO críticos seguidos para el mismo execution_id nunca crean proceso_fallido", async () => {
    const executionId = randomUUID();

    const primero = await reportar({ execution_id: executionId, mensaje: "aviso menor", critico: false });
    expect(primero.status).toBe(201);
    expect(primero.body.proceso_fallido_id).toBeNull();

    const segundo = await reportar({ execution_id: executionId, mensaje: "aviso menor", critico: false });
    expect(segundo.status).toBe(200);
    expect(segundo.body.ya_existia).toBe(true);
    expect(segundo.body.proceso_fallido_id).toBeNull();
  });

  it("promoción: un reporte no crítico seguido de uno crítico para el MISMO execution_id crea el proceso_fallido que faltaba y sube la severidad", async () => {
    const executionId = randomUUID();

    const noCritico = await reportar({ execution_id: executionId, mensaje: "primer intento, parecía menor", critico: false });
    expect(noCritico.status).toBe(201);
    expect(noCritico.body.proceso_fallido_id).toBeNull();

    const [incidenciaInicial] = await db.select().from(incidencias).where(eq(incidencias.id, noCritico.body.incidencia_id));
    expect(incidenciaInicial.severidad).toBe("media");

    // Mismo execution_id, ahora SÍ crítico -- esto es la promoción: no debe
    // perderse en silencio solo porque (execution_id, tipo) ya existía.
    const promovido = await reportar({ execution_id: executionId, mensaje: "en realidad sí era crítico", critico: true });
    expect(promovido.status).toBe(200);
    expect(promovido.body.ya_existia).toBe(true);
    expect(promovido.body.incidencia_id).toBe(noCritico.body.incidencia_id);
    expect(promovido.body.proceso_fallido_id).not.toBeNull();

    const [incidenciaPromovida] = await db.select().from(incidencias).where(eq(incidencias.id, noCritico.body.incidencia_id));
    expect(incidenciaPromovida.severidad).toBe("alta");

    // Un tercer reporte crítico para el mismo execution_id ya NO debe volver
    // a promover (ya hay proceso_fallido) -- misma fila, no una nueva.
    const tercero = await reportar({ execution_id: executionId, mensaje: "tercer aviso, ya promovido", critico: true });
    expect(tercero.status).toBe(200);
    expect(tercero.body.proceso_fallido_id).toBe(promovido.body.proceso_fallido_id);
  });
});
