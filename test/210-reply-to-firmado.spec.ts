import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { ensureSeedAdmin } from "./support/seed.js";
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

    // Con la forma r+<id>.<firma>@ pero sin firma válida: puede ser una
    // respuesta real alterada, así que se deja tarea.
    it.each([
      ["otro dominio", (id: number) => firmarReplyTo(id).replace("@respuestas.contacto.nano-bridge-mex.com", "@otro-dominio.test")],
      ["envío que no existe, aunque la firma sea válida", () => firmarReplyTo(999_999_999)]
    ])("%s: tarea 'no identificada'", async (_caso, direccion) => {
      const prospectoId = await registrarProspecto();
      const envio = await registrarEnvio(prospectoId);
      const res = await registrarRespuesta({ reply_to: direccion(envio.body.id as number) });
      expect(res.status).toBe(201);
      expect(res.body.identificada).toBe(false);
    });

    // Sin la forma: no es respuesta a un correo nuestro (A5, 2-oct-2026).
    it.each([
      ["sin firma", (id: number) => `r+${id}@respuestas.contacto.nano-bridge-mex.com`],
      ["texto cualquiera", () => "ventas@respuestas.contacto.nano-bridge-mex.com"]
    ])("%s: se ignora sin tarea", async (_caso, direccion) => {
      const prospectoId = await registrarProspecto();
      const envio = await registrarEnvio(prospectoId);
      const res = await registrarRespuesta({ reply_to: direccion(envio.body.id as number) });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ identificada: false, ignorada: "direccion_no_valida", tarea_id: null });
    });

    it("una respuesta automática sin firma válida se descarta, sin tarea", async () => {
      const { direccion } = await direccionAlterada();
      const res = await registrarRespuesta({ reply_to: direccion, automatica: true });
      expect(res.status).toBe(201);
      expect(res.body.identificada).toBe(false);
      expect(res.body.tarea_id).toBeNull();
    });
  });

  // A5 del plan de fixes (2-oct-2026). Inbound Parse recibe correo para
  // CUALQUIER dirección del subdominio de respuestas: el spam a info@,
  // ventas@... creaba una tarea "Respuesta no identificada" cada uno. Solo
  // una dirección con la forma r+<id>.<firma>@ es una respuesta nuestra
  // (alterada o no); las demás se ignoran sin tarea.
  describe("direcciones que no son de nuestras respuestas", () => {
    it("una dirección sin la forma r+<id>.<firma>: 200, ignorada y sin tarea", async () => {
      const contenido = `spam ${randomUUID()}`;
      const res = await registrarRespuesta({ reply_to: "info@respuestas.contacto.nano-bridge-mex.com", remitente: "spam@spam.test", contenido, crear_tarea_clasificacion: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ identificada: false, ignorada: "direccion_no_valida", tarea_id: null });
      const tareasCreadas = await db.select().from(tareas).where(eq(tareas.descripcion, `De: spam@spam.test\nPara: info@respuestas.contacto.nano-bridge-mex.com\n\n${contenido}`));
      expect(tareasCreadas).toHaveLength(0);
    });

    it("una respuesta identificada guarda quién la mandó (remitente)", async () => {
      const prospectoId = await registrarProspecto();
      const envio = await registrarEnvio(prospectoId);
      const res = await registrarRespuesta({ reply_to: envio.body.reply_to, remitente: "Compañero <companero@empresa.test>", crear_tarea_clasificacion: true });
      expect(res.status).toBe(201);
      const [fila] = await db.select({ remitente: respuestas.remitente }).from(respuestas).where(eq(respuestas.id, res.body.id));
      expect(fila!.remitente).toBe("Compañero <companero@empresa.test>");

      const cola = await api().get("/api/v1/cola-clasificacion").query({ limit: 100 }).set("Cookie", await ensureSeedAdmin(app));
      const item = (cola.body.data as { id: number; respuesta: { remitente?: string } | null }[]).find((t) => t.id === res.body.tarea_id);
      expect(item?.respuesta?.remitente).toBe("Compañero <companero@empresa.test>");
    });
  });

  describe("POST /supresion con tipo correo", () => {
    function suprimir(valor: string) {
      return api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), tipo: "correo", valor, motivo: "prueba" });
    }

    it("un valor que no es un correo: 400 (antes 201 sin bloquear a nadie)", async () => {
      expect((await suprimir("Juan <juan@empresa.test>")).status).toBe(400);
      expect((await suprimir("no-es-correo")).status).toBe(400);
    });

    it("un correo válido sigue funcionando", async () => {
      expect((await suprimir(`valido.${randomUUID()}@empresa.test`)).status).toBe(201);
    });
  });

  it("exige prospecto_id o reply_to, no los dos ni ninguno", async () => {
    const prospectoId = await registrarProspecto();
    const envio = await registrarEnvio(prospectoId);
    expect((await registrarRespuesta({ prospecto_id: prospectoId, reply_to: envio.body.reply_to })).status).toBe(400);
    expect((await registrarRespuesta({})).status).toBe(400);
  });
});
