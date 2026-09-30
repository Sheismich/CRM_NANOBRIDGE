import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, campanas, envios, mediosContacto, prospectos } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

type Fila = {
  envio_id: number;
  prospecto_id: number;
  es_ultimo_contacto: boolean;
  correo: string | null;
  contacto_nombre: string;
  empresa_nombre: string;
  giro: string | null;
  campana_id: number | null;
  campana_activa: boolean | null;
};
type Omitida = { envio_id: number; prospecto_id: number; motivo: string };

// Flujo de recordatorios (correos 2 y 3, PLAN_N8N_DEFINITIVO.md B2): n8n
// pide las ventanas vencidas y manda el siguiente correo. Antes la
// respuesta no traía a quién mandarlo (ni correo ni nombre: la consulta de
// scoring los excluye a propósito por Gemini), y n8n tenía que ignorar por
// su cuenta las de campañas inactivas. Ahora la API trae los datos del
// correo y no devuelve las filas a las que no se les debe escribir: las
// deja reclamadas (canceladas) y las lista aparte con su motivo
// (decisión del 30-sep-2026).
describe("recordatorios: ventanas vencidas con los datos para el correo", () => {
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

  async function crearCampana(estado: "activa" | "pausada" | "finalizada", fechaFin: string | null = null) {
    const [result] = await db.insert(campanas).values({ nombre: `Campaña ${randomUUID()}`, estado, fechaFin });
    return result.insertId;
  }

  async function registrarProspecto(opciones: { campanaId?: number; correo?: string } = {}) {
    const correo = opciones.correo ?? `recordatorio.${randomUUID()}@recordatorios.test`;
    const res = await api()
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({
        execution_id: randomUUID(),
        empresa: { nombreLegal: `Empresa Recordatorio ${randomUUID()}`, giro: "manufactura" },
        contacto: { nombre: "Persona Recordatorio", correo },
        ...(opciones.campanaId ? { campana_id: opciones.campanaId } : {})
      });
    expect([200, 201]).toContain(res.status);
    return { id: res.body.id as number, correo };
  }

  // Un envío ya vencido y todavía "abierta": lo que reclama el poll.
  async function sembrarVencido(prospectoId: number, numeroContacto = 1) {
    const enviadoEn = new Date(Date.now() - (30 - numeroContacto) * 86_400_000);
    const [result] = await db.insert(envios).values({
      prospectoId,
      canal: "correo",
      numeroContacto,
      ventanaVenceEn: new Date(enviadoEn.getTime() + 7 * 86_400_000),
      ventanaEstado: "abierta",
      executionId: randomUUID(),
      enviadoEn
    });
    return result.insertId;
  }

  async function poll() {
    const res = await api().get("/api/v1/automatizacion/envios/vencidas").set("X-API-Key", API_KEY).query({ limit: 200 });
    expect(res.status).toBe(200);
    return { data: res.body.data as Fila[], omitidas: res.body.omitidas as Omitida[] };
  }

  async function estadoVentana(envioId: number) {
    const [fila] = await db.select({ estado: envios.ventanaEstado }).from(envios).where(eq(envios.id, envioId));
    return fila!.estado;
  }

  it("cada fila trae el correo, el nombre, la empresa, el giro y si su campaña sigue activa", async () => {
    const campanaId = await crearCampana("activa");
    const prospecto = await registrarProspecto({ campanaId });
    const envioId = await sembrarVencido(prospecto.id);

    const fila = (await poll()).data.find((f) => f.envio_id === envioId);
    expect(fila).toMatchObject({
      prospecto_id: prospecto.id,
      correo: prospecto.correo,
      contacto_nombre: "Persona Recordatorio",
      empresa_nombre: expect.stringMatching(/^Empresa Recordatorio /),
      giro: "manufactura",
      campana_id: campanaId,
      campana_activa: true,
      es_ultimo_contacto: false
    });
  });

  it("sin campaña: campana_id y campana_activa vienen en null (n8n decide con el modo pruebas)", async () => {
    const prospecto = await registrarProspecto();
    const envioId = await sembrarVencido(prospecto.id);

    const fila = (await poll()).data.find((f) => f.envio_id === envioId);
    expect(fila).toMatchObject({ campana_id: null, campana_activa: null });
  });

  it.each([
    ["pausada", null],
    ["finalizada", null],
    ["activa", "2020-01-01"]
  ] as const)("campaña %s (fecha_fin %s): no se devuelve, queda cancelada y sale en omitidas", async (estado, fechaFin) => {
    const campanaId = await crearCampana(estado, fechaFin);
    const prospecto = await registrarProspecto({ campanaId });
    const envioId = await sembrarVencido(prospecto.id);

    const primero = await poll();
    expect(primero.data.some((f) => f.envio_id === envioId)).toBe(false);
    expect(primero.omitidas).toContainEqual({ envio_id: envioId, prospecto_id: prospecto.id, motivo: "campana_inactiva" });
    expect(await estadoVentana(envioId)).toBe("vencida");

    // Reclamada: no regresa en la siguiente corrida.
    const segundo = await poll();
    expect(segundo.omitidas.some((o) => o.envio_id === envioId)).toBe(false);

    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "envio"), eq(auditoria.entidadId, envioId), eq(auditoria.accion, "recordatorio_omitido")));
    expect((audit!.despues as { motivo: string }).motivo).toBe("campana_inactiva");
  });

  it("sin correo activo: se omite con motivo sin_correo", async () => {
    const prospecto = await registrarProspecto();
    const envioId = await sembrarVencido(prospecto.id);
    const [fila] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospecto.id));
    await db.update(mediosContacto).set({ estadoContacto: "obsoleto" }).where(and(eq(mediosContacto.contactoId, fila!.contactoId), eq(mediosContacto.tipo, "correo")));

    const { data, omitidas } = await poll();
    expect(data.some((f) => f.envio_id === envioId)).toBe(false);
    expect(omitidas).toContainEqual({ envio_id: envioId, prospecto_id: prospecto.id, motivo: "sin_correo" });
  });

  it("correo en la lista de supresión: se omite con motivo suprimido", async () => {
    const prospecto = await registrarProspecto();
    const envioId = await sembrarVencido(prospecto.id);
    const baja = await api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).send({ execution_id: randomUUID(), tipo: "correo", valor: prospecto.correo, motivo: "link de baja" });
    expect(baja.status).toBe(201);

    const { data, omitidas } = await poll();
    expect(data.some((f) => f.envio_id === envioId)).toBe(false);
    expect(omitidas).toContainEqual({ envio_id: envioId, prospecto_id: prospecto.id, motivo: "suprimido" });
  });

  it.each(["baja", "interesado", "no_interesado", "descartado", "excluido", "inactivo"])("prospecto en estado '%s': se omite con motivo prospecto_cerrado", async (estado) => {
    const prospecto = await registrarProspecto();
    const envioId = await sembrarVencido(prospecto.id);
    await db.update(prospectos).set({ estado }).where(eq(prospectos.id, prospecto.id));

    const { data, omitidas } = await poll();
    expect(data.some((f) => f.envio_id === envioId)).toBe(false);
    expect(omitidas).toContainEqual({ envio_id: envioId, prospecto_id: prospecto.id, motivo: "prospecto_cerrado" });
  });

  // El tercer contacto no manda correo: n8n marca al prospecto inactivo.
  // Eso aplica aunque la campaña ya no esté activa o no haya correo.
  it("la última ventana de la persona sí se devuelve con campaña inactiva, para que n8n la marque inactiva", async () => {
    const campanaId = await crearCampana("finalizada");
    const prospecto = await registrarProspecto({ campanaId });
    await sembrarVencido(prospecto.id, 1);
    await sembrarVencido(prospecto.id, 2);
    const ultimo = await sembrarVencido(prospecto.id, 3);
    await db.update(envios).set({ ventanaEstado: "vencida" }).where(and(eq(envios.prospectoId, prospecto.id), eq(envios.numeroContacto, 1)));
    await db.update(envios).set({ ventanaEstado: "vencida" }).where(and(eq(envios.prospectoId, prospecto.id), eq(envios.numeroContacto, 2)));

    const fila = (await poll()).data.find((f) => f.envio_id === ultimo);
    expect(fila).toMatchObject({ es_ultimo_contacto: true, campana_activa: false });
  });

  describe("sin correos dobles", () => {
    function registrarEnvio(prospectoId: number, executionId: string) {
      return api().post("/api/v1/automatizacion/envios").set("X-API-Key", API_KEY).send({ execution_id: executionId, prospecto_id: prospectoId, canal: "correo" });
    }

    it("dos registros simultáneos del recordatorio de la misma persona: solo uno pasa", async () => {
      const prospecto = await registrarProspecto();
      const envioId = await sembrarVencido(prospecto.id);
      expect((await poll()).data.some((f) => f.envio_id === envioId)).toBe(true);

      const [a, b] = await Promise.all([registrarEnvio(prospecto.id, randomUUID()), registrarEnvio(prospecto.id, randomUUID())]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const suyos = await db.select().from(envios).where(eq(envios.prospectoId, prospecto.id));
      expect(suyos).toHaveLength(2);
    });

    // execution_id fijo por recordatorio ("recordatorio-" + envío anterior):
    // un reintento de n8n recibe ya_existia y NO vuelve a mandar el correo.
    it("un reintento con el mismo execution_id responde ya_existia y no crea otro envío", async () => {
      const prospecto = await registrarProspecto();
      const envioId = await sembrarVencido(prospecto.id);
      await poll();

      const executionId = `recordatorio-${envioId}`;
      expect((await registrarEnvio(prospecto.id, executionId)).status).toBe(201);
      const reintento = await registrarEnvio(prospecto.id, executionId);
      expect(reintento.status).toBe(200);
      expect(reintento.body.ya_existia).toBe(true);
      expect(await db.select().from(envios).where(eq(envios.prospectoId, prospecto.id))).toHaveLength(2);
    });

    it("dos corridas del poll al mismo tiempo no reciben la misma ventana", async () => {
      const prospecto = await registrarProspecto();
      const envioId = await sembrarVencido(prospecto.id);

      const [uno, dos] = await Promise.all([poll(), poll()]);
      const veces = [...uno.data, ...dos.data].filter((f) => f.envio_id === envioId).length;
      expect(veces).toBe(1);
    });
  });
});
