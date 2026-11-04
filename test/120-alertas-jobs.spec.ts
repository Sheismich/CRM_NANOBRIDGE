import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { documentos, notificaciones } from "../src/database/schema.js";
import { DocumentosService } from "../src/documentos/documentos.service.js";
import { TareasService } from "../src/tareas/tareas.service.js";

// Los dos últimos jobs internos de PLAN_API_DEFINITIVO.md: ninguno tiene
// endpoint de disparo manual (mismo criterio que
// ProspectosService.limpiarBorradoresVencidos -- son housekeeping, no algo
// que un usuario necesite forzar), así que se invocan directo desde el
// contenedor de Nest vía app.get(), no por HTTP.
describe("jobs internos: alertas de documentos pendientes y de tareas con SLA vencido", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  let empresaId: number;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    const me = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    expect(me.status).toBe(200);
    adminId = me.body.id;

    const empresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Alertas", contactos: [{ nombre: "Contacto Alertas", correo: `alertas.${Date.now()}@test.local` }] });
    expect(empresa.status).toBe(201);
    empresaId = empresa.body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function avisos(tipo: string, entidadId: number) {
    return db.select().from(notificaciones).where(and(eq(notificaciones.tipo, tipo), eq(notificaciones.entidadId, entidadId)));
  }

  it("un documento vigente sin revisar hace más de 7 días se alerta una sola vez (no antes, no dos veces)", async () => {
    const subida = await request(app.getHttpServer())
      .post("/api/v1/documentos")
      .set("Cookie", adminCookie)
      .field("empresaId", String(empresaId))
      .attach("archivo", Buffer.from("%PDF-1.4 contenido de prueba"), { filename: "pendiente.pdf", contentType: "application/pdf" });
    expect(subida.status).toBe(201);
    const documentoId = subida.body.id as number;

    // Recién subido: todavía no cruza el umbral de 7 días.
    await app.get(DocumentosService).alertarDocumentosPendientes();
    expect(await avisos("documento_sin_revisar", documentoId)).toHaveLength(0);

    // "Adelantar el reloj" escribiendo directo creado_en -- mismo criterio
    // que en el resto de las pruebas, en vez de esperar 8 días reales.
    await db.update(documentos).set({ creadoEn: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }).where(eq(documentos.id, documentoId));

    await app.get(DocumentosService).alertarDocumentosPendientes();
    const primerAviso = await avisos("documento_sin_revisar", documentoId);
    expect(primerAviso.length).toBeGreaterThan(0);
    expect(primerAviso[0]).toEqual(expect.objectContaining({ entidad: "documento", titulo: "Documento sin revisar: pendiente.pdf", cuerpo: "Empresa Alertas", enlace: "/documentos", correoEstado: "pendiente" }));

    // Segunda corrida: alertado_en ya quedó fijo, no debe volver a avisar.
    await app.get(DocumentosService).alertarDocumentosPendientes();
    expect(await avisos("documento_sin_revisar", documentoId)).toHaveLength(primerAviso.length);
  });

  it("marcar el documento como revisado ANTES del umbral evita la alerta por completo", async () => {
    const subida = await request(app.getHttpServer())
      .post("/api/v1/documentos")
      .set("Cookie", adminCookie)
      .field("empresaId", String(empresaId))
      .attach("archivo", Buffer.from("%PDF-1.4 contenido de prueba"), { filename: "revisado.pdf", contentType: "application/pdf" });
    expect(subida.status).toBe(201);
    const documentoId = subida.body.id as number;

    await request(app.getHttpServer()).patch(`/api/v1/documentos/${documentoId}/revisar`).set("Cookie", adminCookie).send({});
    await db.update(documentos).set({ creadoEn: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }).where(eq(documentos.id, documentoId));

    await app.get(DocumentosService).alertarDocumentosPendientes();
    expect(await avisos("documento_sin_revisar", documentoId)).toHaveLength(0);
  });

  it("archivar y reactivar un documento nunca revisado lo vuelve a hacer candidato de alerta (alertado_en se limpia al volver a vigente)", async () => {
    const subida = await request(app.getHttpServer())
      .post("/api/v1/documentos")
      .set("Cookie", adminCookie)
      .field("empresaId", String(empresaId))
      .attach("archivo", Buffer.from("%PDF-1.4 contenido de prueba"), { filename: "reactivado.pdf", contentType: "application/pdf" });
    expect(subida.status).toBe(201);
    const documentoId = subida.body.id as number;

    await db.update(documentos).set({ creadoEn: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }).where(eq(documentos.id, documentoId));
    await app.get(DocumentosService).alertarDocumentosPendientes();
    expect((await avisos("documento_sin_revisar", documentoId)).length).toBeGreaterThan(0);

    const archivar = await request(app.getHttpServer()).patch(`/api/v1/documentos/${documentoId}/estado`).set("Cookie", adminCookie).send({ estado: "archivado" });
    expect(archivar.status).toBe(200);
    const reactivar = await request(app.getHttpServer()).patch(`/api/v1/documentos/${documentoId}/estado`).set("Cookie", adminCookie).send({ estado: "vigente" });
    expect(reactivar.status).toBe(200);

    // Sigue sin revisar y sigue "vieja" (creado_en no cambió) -- debe poder
    // alertar de nuevo, no quedar excluida para siempre por el alertado_en
    // de antes de archivarse.
    await db.delete(notificaciones).where(and(eq(notificaciones.tipo, "documento_sin_revisar"), eq(notificaciones.entidadId, documentoId)));
    await app.get(DocumentosService).alertarDocumentosPendientes();
    expect((await avisos("documento_sin_revisar", documentoId)).length).toBeGreaterThan(0);
  });

  it("una tarea abierta con fecha_limite vencida se alerta una sola vez; una tarea sin fecha_limite nunca se alerta", async () => {
    const vencida = await request(app.getHttpServer())
      .post("/api/v1/tareas")
      .set("Cookie", adminCookie)
      .send({ titulo: "Tarea vencida de prueba", responsableId: adminId, fechaLimite: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    expect(vencida.status).toBe(201);
    const tareaId = vencida.body.id as number;

    const sinFecha = await request(app.getHttpServer())
      .post("/api/v1/tareas")
      .set("Cookie", adminCookie)
      .send({ titulo: "Tarea sin límite de prueba", responsableId: adminId });
    expect(sinFecha.status).toBe(201);
    const sinFechaId = sinFecha.body.id as number;

    await app.get(TareasService).alertarTareasSlaVencidas();

    const primerAviso = await avisos("tarea_vencida", tareaId);
    expect(primerAviso).toHaveLength(1);
    expect(primerAviso[0]!.entidad).toBe("tarea");
    expect(await avisos("tarea_vencida", sinFechaId)).toHaveLength(0);

    // Segunda corrida: no debe duplicar.
    await app.get(TareasService).alertarTareasSlaVencidas();
    expect(await avisos("tarea_vencida", tareaId)).toHaveLength(1);
  });

  it("cerrar la tarea ANTES de que corra el job evita la alerta por completo", async () => {
    const vencida = await request(app.getHttpServer())
      .post("/api/v1/tareas")
      .set("Cookie", adminCookie)
      .send({ titulo: "Tarea vencida pero cerrada a tiempo", responsableId: adminId, fechaLimite: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() });
    expect(vencida.status).toBe(201);
    const tareaId = vencida.body.id as number;

    const cerrar = await request(app.getHttpServer()).patch(`/api/v1/tareas/${tareaId}/cerrar`).set("Cookie", adminCookie).send({ resultado: "Resuelta antes del job" });
    expect(cerrar.status).toBe(200);

    await app.get(TareasService).alertarTareasSlaVencidas();
    expect(await avisos("tarea_vencida", tareaId)).toHaveLength(0);
  });
});
