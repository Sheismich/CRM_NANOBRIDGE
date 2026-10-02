import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, empresas } from "../src/database/schema.js";

// Asignar = dar dueño (C1 del plan de fixes, 2-oct-2026). Un agente solo ve
// las empresas de las que es dueño. Las que crea n8n nacen sin dueño, las
// que da de alta un admin o supervisor quedan a su nombre, y las de un
// agente desactivado se quedan con él: en los tres casos, el agente al que
// un supervisor le asignaba la tarea "Contactar prospecto interesado" veía
// la tarea pero la ficha de la empresa le daba 404. Regla: cuando un admin o
// supervisor le asigna trabajo a un agente, la empresa pasa a ese agente si
// hoy no tiene como dueño a otro agente activo.
describe("asignar trabajo a un agente le da la empresa", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = await idDe(adminCookie);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  async function idDe(cookie: string[]) {
    return (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number;
  }

  async function nuevoAgente() {
    const cookie = await crearAgente(app, adminCookie, `duenos.${randomUUID()}@test.local`);
    return { cookie, id: await idDe(cookie) };
  }

  // Empresa dada de alta por el admin: queda a su nombre (no de un agente).
  async function empresaDelAdmin() {
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa Dueños ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `duenos.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function tareaDe(cookie: string[], empresaId: number, responsableId: number) {
    const res = await api().post("/api/v1/tareas").set("Cookie", cookie).send({ titulo: "Contactar prospecto interesado", empresaId, responsableId });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  const asignar = (tareaId: number, responsableId: number, cookie = adminCookie) =>
    api().patch(`/api/v1/tareas/${tareaId}/asignar`).set("Cookie", cookie).send({ responsableId });

  async function duenoDe(empresaId: number) {
    const [fila] = await db.select({ propietarioId: empresas.propietarioId }).from(empresas).where(eq(empresas.id, empresaId));
    return fila!.propietarioId;
  }

  const tomas = (empresaId: number) =>
    db.select().from(auditoria).where(and(eq(auditoria.entidad, "empresa"), eq(auditoria.entidadId, empresaId), eq(auditoria.accion, "tomar_empresa")));

  it("asignarle la tarea a un agente le da la empresa: ya ve la ficha, y queda en la auditoría", async () => {
    const agente = await nuevoAgente();
    const empresaId = await empresaDelAdmin();
    const tareaId = await tareaDe(adminCookie, empresaId, adminId);
    expect((await api().get(`/api/v1/empresas/${empresaId}`).set("Cookie", agente.cookie)).status).toBe(404);

    expect((await asignar(tareaId, agente.id)).status).toBe(200);

    expect(await duenoDe(empresaId)).toBe(agente.id);
    expect((await api().get(`/api/v1/empresas/${empresaId}`).set("Cookie", agente.cookie)).status).toBe(200);
    const [toma] = await tomas(empresaId);
    expect(toma).toMatchObject({ usuarioId: adminId, antes: { propietario_id: adminId }, despues: { propietario_id: agente.id, tarea_id: tareaId } });
  });

  it("una empresa que ya es de otro agente activo no cambia de dueño (la tarea sí se asigna)", async () => {
    const [a, b] = [await nuevoAgente(), await nuevoAgente()];
    const empresaId = await empresaDelAdmin();
    expect((await asignar(await tareaDe(adminCookie, empresaId, adminId), a.id)).status).toBe(200);

    const otra = await tareaDe(adminCookie, empresaId, adminId);
    expect((await asignar(otra, b.id)).status).toBe(200);
    expect(await duenoDe(empresaId)).toBe(a.id);
    expect(await tomas(empresaId)).toHaveLength(1);
  });

  it("asignar a un supervisor o admin no cambia el dueño (ellos ya ven todo)", async () => {
    const correo = `duenos.sup.${randomUUID()}@test.local`;
    const sup = await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: "Supervisor Dueños", correo, password: "password_supervisor_1", rol: "supervisor" });
    expect(sup.status).toBe(201);
    const agente = await nuevoAgente();
    const empresaId = await empresaDelAdmin();
    const tareaId = await tareaDe(adminCookie, empresaId, agente.id);
    expect(await duenoDe(empresaId)).toBe(agente.id);

    // De vuelta a un supervisor: el agente sigue siendo el dueño.
    expect((await asignar(tareaId, sup.body.id as number)).status).toBe(200);
    expect(await duenoDe(empresaId)).toBe(agente.id);
  });

  it("crear la tarea ya asignada a un agente, o una oportunidad para él, también le da la empresa", async () => {
    const agente = await nuevoAgente();
    const conTarea = await empresaDelAdmin();
    await tareaDe(adminCookie, conTarea, agente.id);
    expect(await duenoDe(conTarea)).toBe(agente.id);

    const conOportunidad = await empresaDelAdmin();
    const op = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId: conOportunidad, titulo: "Oportunidad para el agente", responsableId: agente.id });
    expect(op.status).toBe(201);
    expect(await duenoDe(conOportunidad)).toBe(agente.id);
    const [toma] = await tomas(conOportunidad);
    expect(toma).toMatchObject({ despues: { propietario_id: agente.id, oportunidad_id: op.body.id } });
  });

  it("un agente no se queda con una empresa ajena creándose él mismo una tarea", async () => {
    const agente = await nuevoAgente();
    const empresaId = await empresaDelAdmin();
    await api().post("/api/v1/tareas").set("Cookie", agente.cookie).send({ titulo: "Me la quedo", empresaId, responsableId: agente.id });
    expect(await duenoDe(empresaId)).toBe(adminId);
    expect(await tomas(empresaId)).toHaveLength(0);
  });

  it("la empresa de un agente desactivado pasa al agente al que se le asigna", async () => {
    const [viejo, nuevo] = [await nuevoAgente(), await nuevoAgente()];
    const empresaId = await empresaDelAdmin();
    await tareaDe(adminCookie, empresaId, viejo.id);
    expect(await duenoDe(empresaId)).toBe(viejo.id);
    expect((await api().delete(`/api/v1/usuarios/${viejo.id}`).set("Cookie", adminCookie)).status).toBe(204);

    await tareaDe(adminCookie, empresaId, nuevo.id);
    expect(await duenoDe(empresaId)).toBe(nuevo.id);
  });

  it("dos asignaciones al mismo tiempo a agentes distintos: la empresa queda con uno solo y una sola auditoría", async () => {
    const [a, b] = [await nuevoAgente(), await nuevoAgente()];
    const empresaId = await empresaDelAdmin();
    const [t1, t2] = [await tareaDe(adminCookie, empresaId, adminId), await tareaDe(adminCookie, empresaId, adminId)];

    const [r1, r2] = await Promise.all([asignar(t1, a.id), asignar(t2, b.id)]);
    expect([r1.status, r2.status]).toEqual([200, 200]);
    expect([a.id, b.id]).toContain(await duenoDe(empresaId));
    expect(await tomas(empresaId)).toHaveLength(1);
  });

  it("al confirmar una fila del CSV, la empresa queda de quien la importó, no de quien confirma", async () => {
    const agente = await nuevoAgente();
    const nombre = `Empresa CSV Dueños ${randomUUID()}`;
    const csv = ["empresaNombreLegal,contactoNombre,correo,canalInicial", `${nombre},Contacto CSV,csv.${randomUUID()}@test.local,correo`].join("\n");
    const lote = await api().post("/api/v1/prospectos/importaciones").set("Cookie", agente.cookie).attach("archivo", Buffer.from(csv), "duenos.csv");
    expect(lote.status).toBe(201);
    const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", adminCookie);
    const [fila] = detalle.body.filas as { id: number }[];

    const confirmada = await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${fila!.id}/confirmar`).set("Cookie", adminCookie).send({});
    expect(confirmada.status).toBe(200);
    expect(await duenoDe(confirmada.body.empresa_id as number)).toBe(agente.id);
  });
});
