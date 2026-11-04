import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq, inArray } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { contactos, correosRespuesta, empresas, envios, notificaciones, prospectos, respuestas, tareas } from "../src/database/schema.js";
import { TITULO_TAREA_INTERESADO, TareasService } from "../src/tareas/tareas.service.js";

const API_KEY = "test_crm_callback_api_key_0001";
const HACE_UNA_SEMANA = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

// Un interesado olvidado es la venta más cara de perder: si después de un día
// hábil nadie lo tomó, sube de prioridad y se avisa a supervisores.
describe("escalar interesados sin atender", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const escalar = () => app.get(TareasService).escalarInteresadosSinAtender();

  async function tarea(valores: Partial<typeof tareas.$inferInsert> = {}) {
    const [fila] = await db.insert(tareas).values({ tipo: "seguimiento", titulo: TITULO_TAREA_INTERESADO, prioridad: "alta", creadoEn: HACE_UNA_SEMANA(), ...valores });
    return fila.insertId;
  }
  const filaDe = async (id: number) => (await db.select().from(tareas).where(eq(tareas.id, id)))[0]!;
  const avisos = (id: number) => db.select().from(notificaciones).where(and(eq(notificaciones.tipo, "interesado"), eq(notificaciones.entidad, "tarea"), eq(notificaciones.entidadId, id)));

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("un interesado sin tomar sube a urgente y avisa una sola vez, con correo", async () => {
    const id = await tarea();
    expect(await escalar()).toBeGreaterThan(0);

    const fila = await filaDe(id);
    expect(fila.prioridad).toBe("urgente");
    expect(fila.escaladoEn).not.toBeNull();
    const primeros = await avisos(id);
    expect(primeros.length).toBeGreaterThan(0);
    expect(primeros[0]).toEqual(expect.objectContaining({ correoEstado: "pendiente", enlace: expect.stringContaining(String(id)) }));
    expect(primeros[0]!.titulo).toMatch(/^Interesado sin atender/);

    await escalar();
    expect(await avisos(id)).toHaveLength(primeros.length);
  });

  it("no le quita la tarea a quien la tiene", async () => {
    const agenteCookie = await crearAgente(app, adminCookie, `escalar.${randomUUID()}@test.local`);
    const agente = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body as { id: number };
    const id = await tarea({ responsableId: agente.id });
    await escalar();
    const fila = await filaDe(id);
    expect(fila.prioridad).toBe("urgente");
    expect(fila.responsableId).toBe(agente.id);
  });

  it("no toca lo recién creado, lo que ya se tomó, lo cerrado ni otras tareas", async () => {
    const ids = [
      await tarea({ creadoEn: new Date() }),
      await tarea({ estado: "en_progreso" }),
      await tarea({ estado: "cerrada" }),
      await tarea({ titulo: "Otra tarea" })
    ];
    await escalar();
    const filas = await db.select({ escaladoEn: tareas.escaladoEn }).from(tareas).where(inArray(tareas.id, ids));
    expect(filas.every((f) => f.escaladoEn === null)).toBe(true);
  });

  it("si un vendedor ya le contestó al prospecto, no se escala aunque la tarea siga abierta", async () => {
    const sufijo = randomUUID();
    const [empresa] = await db.insert(empresas).values({ nombreLegal: `Escalar ${sufijo}` });
    const [contacto] = await db.insert(contactos).values({ empresaId: empresa.insertId, nombre: "Persona" });
    const [prospecto] = await db.insert(prospectos).values({ contactoId: contacto.insertId, estado: "interesado" });
    const [envio] = await db.insert(envios).values({ prospectoId: prospecto.insertId, numeroContacto: 1, ventanaVenceEn: new Date() });
    const [respuesta] = await db.insert(respuestas).values({ prospectoId: prospecto.insertId, envioId: envio.insertId, contenido: "Me interesa" });
    const me = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body as { id: number };
    await db.insert(correosRespuesta).values({ respuestaId: respuesta.insertId, prospectoId: prospecto.insertId, usuarioId: me.id, para: "a@b.test", asunto: "Hola", texto: "Hola", estado: "enviado" });

    const id = await tarea({ prospectoId: prospecto.insertId });
    await escalar();
    expect((await filaDe(id)).escaladoEn).toBeNull();
  });

  it("corre como trabajo propio y dentro del trabajo diario", async () => {
    const propio = await tarea();
    const res = await api().post("/api/v1/automatizacion/jobs/escalar-interesados").set("X-API-Key", API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.procesados).toBeGreaterThan(0);
    expect((await filaDe(propio)).escaladoEn).not.toBeNull();

    const diario = await tarea();
    const sla = await api().post("/api/v1/automatizacion/jobs/sla-tareas").set("X-API-Key", API_KEY);
    expect(sla.body.interesados_escalados).toBeGreaterThan(0);
    expect((await filaDe(diario)).escaladoEn).not.toBeNull();
  });
});
