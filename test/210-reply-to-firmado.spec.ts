import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { respuestas, tareas } from "../src/database/schema.js";
import { firmarReplyTo } from "../src/shared/reply-to.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Reply-To firmado (ronda 3 de SendGrid, PLAN_N8N_DEFINITIVO.md,
// 29-sep-2026): cada correo sale con r+<envio_id>.<firma>@<dominio>. La API
// firma y verifica; n8n nunca tiene la clave (n8n Cloud no tiene dónde
// guardarla fuera de un nodo). Una dirección sin firma válida no se le
// atribuye a nadie: queda como tarea "Respuesta no identificada".
describe("Reply-To firmado", () => {
  let app: INestApplication;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function registrarProspecto() {
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: randomUUID(), empresa: { nombreLegal: `Empresa ReplyTo ${randomUUID()}` }, contacto: { nombre: "Persona ReplyTo", correo: `replyto.${randomUUID()}@respuestas.test` } });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function registrarEnvio(prospectoId: number, executionId: string = randomUUID()) {
    return api()
      .post("/api/v1/automatizacion/envios")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: executionId, prospecto_id: prospectoId, canal: "correo" });
  }

  function registrarRespuesta(body: Record<string, unknown>, executionId: string = randomUUID()) {
    return api()
      .post("/api/v1/automatizacion/respuestas")
      .set("X-API-Key", API_KEY)
      .send({ execution_id: executionId, canal: "correo", contenido: "Sí me interesa", ...body });
  }

  it("POST /envios devuelve el Reply-To firmado del envío, el mismo en un reintento", async () => {
    const prospectoId = await registrarProspecto();
    const executionId = randomUUID();
    const res = await registrarEnvio(prospectoId, executionId);
    expect(res.status).toBe(201);
    expect(res.body.reply_to).toMatch(new RegExp(`^r\\+${res.body.id}\\.[0-9a-f]{16}@respuestas\\.contacto\\.nano-bridge-mex\\.com$`));
    expect(res.body.reply_to.split("@")[0].length).toBeLessThanOrEqual(64);

    const reintento = await registrarEnvio(prospectoId, executionId);
    expect(reintento.status).toBe(200);
    expect(reintento.body.reply_to).toBe(res.body.reply_to);
  });

  it("una respuesta a ese Reply-To se registra para su prospecto, sin mandar prospecto_id", async () => {
    const prospectoId = await registrarProspecto();
    const envio = await registrarEnvio(prospectoId);

    const res = await registrarRespuesta({ reply_to: envio.body.reply_to, crear_tarea_clasificacion: true });
    expect(res.status).toBe(201);
    expect(res.body.identificada).toBe(true);
    expect(res.body.prospecto_id).toBe(prospectoId);
    expect(res.body.tardia).toBe(false);

    const [respuesta] = await db.select({ prospectoId: respuestas.prospectoId, envioId: respuestas.envioId }).from(respuestas).where(eq(respuestas.id, res.body.id));
    expect(respuesta).toEqual({ prospectoId, envioId: envio.body.id });
  });

  it("acepta la dirección en mayúsculas y con espacios alrededor", async () => {
    const prospectoId = await registrarProspecto();
    const envio = await registrarEnvio(prospectoId);
    const res = await registrarRespuesta({ reply_to: `  ${String(envio.body.reply_to).toUpperCase()} ` });
    expect(res.status).toBe(201);
    expect(res.body.prospecto_id).toBe(prospectoId);
  });

  describe("sin firma válida: tarea 'Respuesta no identificada'", () => {
    async function direccionAlterada() {
      const prospectoId = await registrarProspecto();
      const envio = await registrarEnvio(prospectoId);
      const [local, dominio] = String(envio.body.reply_to).split("@");
      const firma = local!.slice(-16);
      const otraFirma = firma.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
      return { prospectoId, direccion: `${local!.slice(0, -16)}${otraFirma}@${dominio}` };
    }

    it("firma alterada: no se guarda respuesta y se crea una tarea sin prospecto con remitente y contenido", async () => {
      const { prospectoId, direccion } = await direccionAlterada();
      const antes = await db.select({ id: respuestas.id }).from(respuestas).where(eq(respuestas.prospectoId, prospectoId));

      const res = await registrarRespuesta({ reply_to: direccion, remitente: "alguien@empresa.test", crear_tarea_clasificacion: true });
      expect(res.status).toBe(201);
      expect(res.body.identificada).toBe(false);
      expect(res.body.id).toBeNull();
      expect(res.body.tarea_id).toEqual(expect.any(Number));

      const [tarea] = await db.select().from(tareas).where(eq(tareas.id, res.body.tarea_id));
      expect(tarea!.tipo).toBe("seguimiento");
      expect(tarea!.titulo).toBe("Respuesta no identificada");
      expect(tarea!.prospectoId).toBeNull();
      expect(tarea!.descripcion).toContain("alguien@empresa.test");
      expect(tarea!.descripcion).toContain(direccion);
      expect(tarea!.descripcion).toContain("Sí me interesa");

      const despues = await db.select({ id: respuestas.id }).from(respuestas).where(eq(respuestas.prospectoId, prospectoId));
      expect(despues).toHaveLength(antes.length);
    });

    it("un reintento con el mismo execution_id no crea otra tarea", async () => {
      const { direccion } = await direccionAlterada();
      const executionId = `msg-${randomUUID()}`.padEnd(100, "x");
      const primero = await registrarRespuesta({ reply_to: direccion }, executionId);
      const segundo = await registrarRespuesta({ reply_to: direccion }, executionId);
      expect(primero.status).toBe(201);
      expect(segundo.status).toBe(200);
      expect(segundo.body.ya_existia).toBe(true);
      expect(segundo.body.tarea_id).toBe(primero.body.tarea_id);
    });

    it.each([
      ["otro dominio", (id: number) => firmarReplyTo(id).replace("@respuestas.contacto.nano-bridge-mex.com", "@otro-dominio.test")],
      ["sin firma", (id: number) => `r+${id}@respuestas.contacto.nano-bridge-mex.com`],
      ["texto cualquiera", () => "ventas@respuestas.contacto.nano-bridge-mex.com"],
      ["envío que no existe, aunque la firma sea válida", () => firmarReplyTo(999_999_999)]
    ])("%s", async (_caso, direccion) => {
      const prospectoId = await registrarProspecto();
      const envio = await registrarEnvio(prospectoId);
      const res = await registrarRespuesta({ reply_to: direccion(envio.body.id as number) });
      expect(res.status).toBe(201);
      expect(res.body.identificada).toBe(false);
    });

    it("una respuesta automática sin firma válida se descarta, sin tarea", async () => {
      const { direccion } = await direccionAlterada();
      const res = await registrarRespuesta({ reply_to: direccion, automatica: true });
      expect(res.status).toBe(201);
      expect(res.body.identificada).toBe(false);
      expect(res.body.tarea_id).toBeNull();
    });
  });

  it("exige prospecto_id o reply_to, no los dos ni ninguno", async () => {
    const prospectoId = await registrarProspecto();
    const envio = await registrarEnvio(prospectoId);
    expect((await registrarRespuesta({ prospecto_id: prospectoId, reply_to: envio.body.reply_to })).status).toBe(400);
    expect((await registrarRespuesta({})).status).toBe(400);
  });
});
