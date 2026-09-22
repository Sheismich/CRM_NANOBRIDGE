import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, eventosPendientes, tareas } from "../src/database/schema.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";

// Bandeja de tareas (TareasController), cola de clasificación
// (ColaClasificacionController) y el endpoint de automatización que usa n8n
// para crearlas (POST /automatizacion/tareas) -- ninguno tenía cobertura
// propia todavía (120-alertas-jobs.spec.ts solo toca tareas de paso, para
// el job de SLA).
describe("tareas: bandeja, cierre y cola de clasificación", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agente1: { cookie: string[]; id: number };
  let agente2: { cookie: string[]; id: number };
  const sufijo = Date.now();
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const a1 = await crearAgente(app, adminCookie, `tareas.a1.${sufijo}@test.local`);
    const a2 = await crearAgente(app, adminCookie, `tareas.a2.${sufijo}@test.local`);
    agente1 = { cookie: a1, id: await idDe(a1) };
    agente2 = { cookie: a2, id: await idDe(a2) };
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function idDe(cookie: string[]) {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", cookie);
    return res.body.id as number;
  }

  async function crearTarea(cookie: string[], body: Record<string, unknown>) {
    const res = await request(app.getHttpServer()).post("/api/v1/tareas").set("Cookie", cookie).send(body);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  // Registra un prospecto real (vía el endpoint de n8n) para poder cumplir
  // el FK tareas.prospecto_id -> prospectos.id: no hay forma de llegar a un
  // prospecto ya confirmado desde el alta manual del CRM sin pasar por todo
  // el flujo de importación (borrador -> confirmar), y esto no es lo que
  // esta prueba busca cubrir.
  async function crearProspecto() {
    const res = await request(app.getHttpServer())
      .post("/api/v1/automatizacion/prospectos")
      .set("X-API-Key", API_KEY)
      .send({
        execution_id: `tareas-flujo-${randomUUID()}`,
        empresa: { nombreLegal: `Empresa Prospecto Tareas ${randomUUID()}` },
        contacto: { nombre: "Contacto Prospecto", correo: `prospecto.tareas.${randomUUID()}@test.local` }
      });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function cerrar(cookie: string[], id: number, resultado = "resuelto") {
    return request(app.getHttpServer()).patch(`/api/v1/tareas/${id}/cerrar`).set("Cookie", cookie).send({ resultado });
  }

  function clasificar(cookie: string[], id: number, body: Record<string, unknown> = { clasificacion: "interesado" }) {
    return request(app.getHttpServer()).post(`/api/v1/cola-clasificacion/${id}/clasificar`).set("Cookie", cookie).send(body);
  }

  describe("bandeja: creación, lectura y scoping por agente", () => {
    it("un agente solo ve sus propias tareas; administrador ve y filtra por cualquier responsable", async () => {
      const idAgente1 = await crearTarea(adminCookie, { titulo: "Tarea de agente 1", responsableId: agente1.id });
      const idAgente2 = await crearTarea(adminCookie, { titulo: "Tarea de agente 2", responsableId: agente2.id });

      expect((await request(app.getHttpServer()).get(`/api/v1/tareas/${idAgente1}`).set("Cookie", agente1.cookie)).status).toBe(200);
      expect((await request(app.getHttpServer()).get(`/api/v1/tareas/${idAgente1}`).set("Cookie", agente2.cookie)).status).toBe(404);
      expect((await request(app.getHttpServer()).get(`/api/v1/tareas/${idAgente1}`).set("Cookie", adminCookie)).status).toBe(200);

      const listaAgente1 = await request(app.getHttpServer()).get("/api/v1/tareas").set("Cookie", agente1.cookie);
      expect(listaAgente1.body.data.map((t: { id: number }) => t.id)).toContain(idAgente1);
      expect(listaAgente1.body.data.map((t: { id: number }) => t.id)).not.toContain(idAgente2);

      const listaAdminFiltrada = await request(app.getHttpServer()).get(`/api/v1/tareas?responsableId=${agente1.id}`).set("Cookie", adminCookie);
      expect(listaAdminFiltrada.body.data.map((t: { id: number }) => t.id)).toContain(idAgente1);
      expect(listaAdminFiltrada.body.data.map((t: { id: number }) => t.id)).not.toContain(idAgente2);
    });

    it("sin sesión responde 401", async () => {
      expect((await request(app.getHttpServer()).get("/api/v1/tareas")).status).toBe(401);
      expect((await request(app.getHttpServer()).post("/api/v1/tareas").send({})).status).toBe(401);
    });
  });

  describe("cerrar()", () => {
    it("pasa a cerrada, fija cerrada_en, encola 'tarea_cerrada' y deja rastro en auditoría", async () => {
      const id = await crearTarea(adminCookie, { titulo: "Tarea a cerrar", responsableId: agente1.id });

      expect((await cerrar(agente2.cookie, id)).status).toBe(404);

      const res = await cerrar(agente1.cookie, id, "cliente confirmó la cita");
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe("cerrada");
      expect(res.body.resultado).toBe("cliente confirmó la cita");
      expect(res.body.cerrada_en).not.toBeNull();

      const [evento] = await db.select().from(eventosPendientes).where(and(eq(eventosPendientes.tipo, "tarea_cerrada"), eq(eventosPendientes.entidadId, id)));
      expect(evento).toBeDefined();
      expect((evento!.payload as { tarea_id: number }).tarea_id).toBe(id);

      const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "tarea"), eq(auditoria.entidadId, id), eq(auditoria.accion, "cerrar")));
      expect(audit).toBeDefined();
    });

    it("una tarea ya cerrada, o cancelada (estado no alcanzable por la API), no se puede volver a cerrar", async () => {
      const idCerrada = await crearTarea(adminCookie, { titulo: "Tarea doble cierre", responsableId: agente1.id });
      await cerrar(agente1.cookie, idCerrada);
      expect((await cerrar(agente1.cookie, idCerrada)).status).toBe(409);

      // 'cancelada' no lo fija ningún endpoint hoy (ver comentario en
      // tareas.service.ts) -- se simula escribiendo directo, mismo criterio
      // que "adelantar el reloj" en 50-outbox-dispatcher-retry.spec.ts.
      const idCancelada = await crearTarea(adminCookie, { titulo: "Tarea cancelada", responsableId: agente1.id });
      await db.update(tareas).set({ estado: "cancelada" }).where(eq(tareas.id, idCancelada));
      expect((await cerrar(agente1.cookie, idCancelada)).status).toBe(409);
    });

    it("dos cierres simultáneos sobre la misma tarea: solo uno gana", async () => {
      const id = await crearTarea(adminCookie, { titulo: "Tarea cierre concurrente", responsableId: agente1.id });
      const [a, b] = await Promise.all([cerrar(adminCookie, id, "primero"), cerrar(adminCookie, id, "segundo")]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
    });
  });

  describe("cola de clasificación", () => {
    it("solo lista tareas tipo='clasificacion' y estado='pendiente'", async () => {
      const prospectoId = await crearProspecto();
      const idSeguimiento = await crearTarea(adminCookie, { tipo: "seguimiento", titulo: "No es clasificación", responsableId: agente1.id });
      const idClasificacion = await crearTarea(adminCookie, { tipo: "clasificacion", titulo: "Clasificar prospecto", responsableId: agente1.id, prospectoId });

      const cola = await request(app.getHttpServer()).get("/api/v1/cola-clasificacion").set("Cookie", agente1.cookie);
      expect(cola.status).toBe(200);
      const ids = cola.body.data.map((t: { id: number }) => t.id);
      expect(ids).toContain(idClasificacion);
      expect(ids).not.toContain(idSeguimiento);

      await clasificar(agente1.cookie, idClasificacion);
      const colaDespues = await request(app.getHttpServer()).get("/api/v1/cola-clasificacion").set("Cookie", agente1.cookie);
      expect(colaDespues.body.data.map((t: { id: number }) => t.id)).not.toContain(idClasificacion);
    });

    it("clasificar exige tipo='clasificacion' (409) y un prospecto asociado (409)", async () => {
      const idSeguimiento = await crearTarea(adminCookie, { tipo: "seguimiento", titulo: "Tipo incorrecto", responsableId: agente1.id });
      expect((await clasificar(agente1.cookie, idSeguimiento)).status).toBe(409);

      const idSinProspecto = await crearTarea(adminCookie, { tipo: "clasificacion", titulo: "Sin prospecto", responsableId: agente1.id });
      expect((await clasificar(agente1.cookie, idSinProspecto)).status).toBe(409);
    });

    it("clasificar cierra la tarea, encola 'prospecto_clasificado' con el prospecto correcto y audita", async () => {
      const prospectoId = await crearProspecto();
      const id = await crearTarea(adminCookie, { tipo: "clasificacion", titulo: "Clasificar con comentario", responsableId: agente1.id, prospectoId });

      const res = await clasificar(agente1.cookie, id, { clasificacion: "no_interesado", comentario: "ya tiene proveedor" });
      expect(res.status).toBe(200);
      expect(res.body.estado).toBe("cerrada");
      expect(res.body.clasificacion).toBe("no_interesado");

      const [evento] = await db.select().from(eventosPendientes).where(and(eq(eventosPendientes.tipo, "prospecto_clasificado"), eq(eventosPendientes.entidadId, prospectoId)));
      expect(evento).toBeDefined();
      expect((evento!.payload as { tarea_id: number; clasificacion: string }).tarea_id).toBe(id);
      expect((evento!.payload as { clasificacion: string }).clasificacion).toBe("no_interesado");

      const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "tarea"), eq(auditoria.entidadId, id), eq(auditoria.accion, "clasificar")));
      expect(audit).toBeDefined();
    });

    it("scoping: un agente no puede clasificar la tarea de otro agente", async () => {
      const prospectoId = await crearProspecto();
      const id = await crearTarea(adminCookie, { tipo: "clasificacion", titulo: "De agente 1", responsableId: agente1.id, prospectoId });
      expect((await clasificar(agente2.cookie, id)).status).toBe(404);
    });

    it("sin sesión responde 401", async () => {
      expect((await request(app.getHttpServer()).get("/api/v1/cola-clasificacion")).status).toBe(401);
    });
  });

  describe("POST /automatizacion/tareas (n8n)", () => {
    it("crea una tarea sin responsable (bandeja sin asignar) y es idempotente por execution_id", async () => {
      const executionId = `tarea-automatizacion-${randomUUID()}`;
      const prospectoId = await crearProspecto();
      const body = { execution_id: executionId, prospecto_id: prospectoId, tipo: "clasificacion", titulo: "Tarea creada por n8n", prioridad: "alta" };

      const primera = await request(app.getHttpServer()).post("/api/v1/automatizacion/tareas").set("X-API-Key", API_KEY).send(body);
      expect(primera.status).toBe(201);
      expect(primera.body.ya_existia).toBe(false);

      const detalle = await request(app.getHttpServer()).get(`/api/v1/tareas/${primera.body.id}`).set("Cookie", adminCookie);
      expect(detalle.body.responsable_id).toBeNull();
      expect(detalle.body.creada_por).toBeNull();
      expect(detalle.body.prioridad).toBe("alta");

      const segunda = await request(app.getHttpServer()).post("/api/v1/automatizacion/tareas").set("X-API-Key", API_KEY).send(body);
      expect(segunda.status).toBe(200);
      expect(segunda.body).toEqual({ id: primera.body.id, ya_existia: true });
    });

    it("un prospecto_id inexistente responde 404", async () => {
      const res = await request(app.getHttpServer())
        .post("/api/v1/automatizacion/tareas")
        .set("X-API-Key", API_KEY)
        .send({ execution_id: `tarea-prospecto-inexistente-${randomUUID()}`, prospecto_id: 999999, titulo: "No debería crearse" });
      expect(res.status).toBe(404);
    });

    it("sin X-API-Key responde 401, y una cookie de sesión no sirve como API key", async () => {
      const body = { execution_id: `tarea-sin-key-${randomUUID()}`, titulo: "Sin llave" };
      expect((await request(app.getHttpServer()).post("/api/v1/automatizacion/tareas").send(body)).status).toBe(401);
      expect((await request(app.getHttpServer()).post("/api/v1/automatizacion/tareas").set("Cookie", adminCookie).send(body)).status).toBe(401);
    });
  });
});
