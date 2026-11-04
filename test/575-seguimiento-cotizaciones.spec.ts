import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { cotizaciones, notificaciones, oportunidades, tareas } from "../src/database/schema.js";
import { CotizacionesService, TITULO_SEGUIMIENTO_COTIZACION } from "../src/comercial/cotizaciones.service.js";
import { fechaMx } from "../src/shared/dia-habil.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Una cotización enviada se enfría si nadie la reclama: a los 5 días hábiles
// sin respuesta, el responsable de la oportunidad recibe una tarea.
describe("seguimiento de cotizaciones", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const correr = () => app.get(CotizacionesService).crearSeguimientos();
  const haceDias = (dias: number) => fechaMx(new Date(Date.now() - dias * 24 * 60 * 60 * 1000));

  async function cotizacion(cookie: string[] = adminCookie) {
    const sufijo = randomUUID();
    const empresa = await api().post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal: `Seguimiento ${sufijo}`, contactos: [{ nombre: "Laura", correo: `laura.${sufijo}@cliente.test` }] });
    const detalle = await api().get(`/api/v1/empresas/${empresa.body.id}`).set("Cookie", cookie);
    const op = await api().post("/api/v1/oportunidades").set("Cookie", cookie).send({ empresaId: empresa.body.id, titulo: `Moldes ${sufijo}` });
    const cot = await api().post("/api/v1/cotizaciones").set("Cookie", cookie).send({
      empresaId: empresa.body.id,
      oportunidadId: op.body.id,
      contactoId: detalle.body.contactos[0].id,
      partidas: [{ descripcion: "Molde", cantidad: 1, precioUnitario: 1000 }],
      fechaEmision: fechaMx(new Date())
    });
    expect(cot.status).toBe(201);
    return { id: cot.body.id as number, empresaId: empresa.body.id as number, oportunidadId: op.body.id as number };
  }

  // Enviada hace dos semanas: siempre cumple los 5 días hábiles.
  async function enviadaHaceTiempo(cookie: string[] = adminCookie) {
    const c = await cotizacion(cookie);
    await db.update(cotizaciones).set({ estado: "enviada", fechaEnvio: haceDias(14) }).where(eq(cotizaciones.id, c.id));
    return c;
  }
  const tareasDe = (id: number) => db.select().from(tareas).where(eq(tareas.cotizacionId, id));

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("a los 5 días hábiles crea una tarea para el responsable, y una sola", async () => {
    const agenteCookie = await crearAgente(app, adminCookie, `seguimiento.${randomUUID()}@test.local`);
    const agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id as number;
    const c = await enviadaHaceTiempo(agenteCookie);
    expect(await correr()).toBeGreaterThan(0);

    const [tarea] = await tareasDe(c.id);
    expect(tarea).toEqual(expect.objectContaining({ titulo: TITULO_SEGUIMIENTO_COTIZACION, tipo: "seguimiento", responsableId: agenteId, empresaId: c.empresaId, estado: "pendiente" }));
    expect(tarea!.fechaLimite).not.toBeNull();
    const avisos = await db.select().from(notificaciones).where(and(eq(notificaciones.tipo, "tarea_asignada"), eq(notificaciones.entidadId, tarea!.id)));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toEqual(expect.objectContaining({ usuarioId: agenteId, correoEstado: "pendiente" }));

    await correr();
    expect(await tareasDe(c.id)).toHaveLength(1);
  });

  it("no crea tarea si se envió hace poco, sigue en borrador o la oportunidad ya cerró", async () => {
    const reciente = await cotizacion();
    await db.update(cotizaciones).set({ estado: "enviada", fechaEnvio: haceDias(1) }).where(eq(cotizaciones.id, reciente.id));
    const borrador = await cotizacion();
    const cerrada = await enviadaHaceTiempo();
    await db.update(oportunidades).set({ cerrada: true }).where(eq(oportunidades.id, cerrada.oportunidadId));

    await correr();
    for (const c of [reciente, borrador, cerrada]) expect(await tareasDe(c.id)).toHaveLength(0);
  });

  it("si el responsable ya no está, queda sin asignar para el equipo", async () => {
    const agenteCookie = await crearAgente(app, adminCookie, `seguimiento.${randomUUID()}@test.local`);
    const agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id as number;
    const c = await enviadaHaceTiempo(agenteCookie);
    expect((await api().delete(`/api/v1/usuarios/${agenteId}`).set("Cookie", adminCookie)).status).toBe(204);

    await correr();
    const [tarea] = await tareasDe(c.id);
    expect(tarea!.responsableId).toBeNull();
    const avisos = await db.select().from(notificaciones).where(and(eq(notificaciones.tipo, "tarea_asignada"), eq(notificaciones.entidadId, tarea!.id), eq(notificaciones.usuarioId, adminId)));
    expect(avisos).toHaveLength(1);
  });

  it("aceptarla o rechazarla cancela la tarea abierta", async () => {
    const aceptada = await enviadaHaceTiempo();
    const rechazada = await enviadaHaceTiempo();
    await correr();

    expect((await api().patch(`/api/v1/cotizaciones/${aceptada.id}/estado`).set("Cookie", adminCookie).send({ estado: "aceptada" })).status).toBe(200);
    expect((await api().patch(`/api/v1/cotizaciones/${rechazada.id}/estado`).set("Cookie", adminCookie).send({ estado: "rechazada", motivoRechazo: "precio" })).status).toBe(200);

    expect((await tareasDe(aceptada.id))[0]).toEqual(expect.objectContaining({ estado: "cancelada", resultado: "Cancelada: la cotización ya no sigue abierta" }));
    expect((await tareasDe(rechazada.id))[0]!.estado).toBe("cancelada");
  });

  it("una versión nueva cancela la de la anterior, y vencer también", async () => {
    const versionada = await enviadaHaceTiempo();
    const vencida = await enviadaHaceTiempo();
    await correr();

    const nueva = await api().post(`/api/v1/cotizaciones/${versionada.id}/version`).set("Cookie", adminCookie).send({
      partidas: [{ descripcion: "Molde", cantidad: 2, precioUnitario: 900 }],
      fechaEmision: fechaMx(new Date())
    });
    expect(nueva.status).toBe(201);
    expect((await tareasDe(versionada.id))[0]!.estado).toBe("cancelada");

    expect((await api().patch(`/api/v1/cotizaciones/${vencida.id}/estado`).set("Cookie", adminCookie).send({ estado: "vencida" })).status).toBe(200);
    expect((await tareasDe(vencida.id))[0]!.estado).toBe("cancelada");
  });

  it("el trabajo que vence cotizaciones también cancela su tarea", async () => {
    const c = await enviadaHaceTiempo();
    await correr();
    await db.update(cotizaciones).set({ fechaEsperadaCierre: haceDias(2) }).where(eq(cotizaciones.id, c.id));
    await app.get(CotizacionesService).vencerCotizacionesPasadas();
    expect((await tareasDe(c.id))[0]!.estado).toBe("cancelada");
  });

  it("cerrar la oportunidad cancela las tareas de todas sus cotizaciones", async () => {
    const perdida = await enviadaHaceTiempo();
    await correr();
    const res = await api().patch(`/api/v1/oportunidades/${perdida.oportunidadId}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "perdida", motivoPerdidaClave: "otro", motivoPerdidaDetalle: "Ya no sigue" });
    expect(res.status).toBe(200);
    expect((await tareasDe(perdida.id))[0]!.estado).toBe("cancelada");

    const ganadora = await enviadaHaceTiempo();
    const [hermana] = await db.insert(cotizaciones).values({ empresaId: ganadora.empresaId, oportunidadId: ganadora.oportunidadId, subtotal: "1000.00", total: "1000.00", fechaEmision: haceDias(20), fechaEnvio: haceDias(14), estado: "enviada", creadoPor: adminId });
    await correr();
    expect((await api().patch(`/api/v1/cotizaciones/${ganadora.id}/estado`).set("Cookie", adminCookie).send({ estado: "aceptada" })).status).toBe(200);
    expect((await tareasDe(hermana.insertId))[0]!.estado).toBe("cancelada");
  });

  it("corre dentro del trabajo diario", async () => {
    const c = await enviadaHaceTiempo();
    const res = await api().post("/api/v1/automatizacion/jobs/sla-tareas").set("X-API-Key", API_KEY);
    expect(res.status).toBe(200);
    expect(res.body.cotizaciones_en_seguimiento).toBeGreaterThan(0);
    expect(await tareasDe(c.id)).toHaveLength(1);
  });
});
