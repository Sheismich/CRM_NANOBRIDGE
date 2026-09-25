import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";

describe("oportunidades: pipeline, cierre/reapertura y scoping", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    const empresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Oportunidades", contactos: [{ nombre: "Contacto Oportunidades", correo: `oportunidades.${Date.now()}@test.local` }] });
    expect(empresa.status).toBe(201);
    empresaId = empresa.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  async function crearOportunidad(cookie: string[], titulo: string) {
    const res = await request(app.getHttpServer()).post("/api/v1/oportunidades").set("Cookie", cookie).send({ empresaId, titulo });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  it("un agente no puede ver una oportunidad asignada a otro agente (404), pero sí la suya", async () => {
    const agente1 = await crearAgente(app, adminCookie, `op.agente1.${Date.now()}@test.local`);
    const agente2 = await crearAgente(app, adminCookie, `op.agente2.${Date.now()}@test.local`);
    const oportunidadId = await crearOportunidad(agente1, "Oportunidad de agente 1");

    const propia = await request(app.getHttpServer()).get(`/api/v1/oportunidades/${oportunidadId}`).set("Cookie", agente1);
    expect(propia.status).toBe(200);
    expect(propia.body.responsable_id).not.toBeNull();

    const ajena = await request(app.getHttpServer()).get(`/api/v1/oportunidades/${oportunidadId}`).set("Cookie", agente2);
    expect(ajena.status).toBe(404);
  });

  it("una oportunidad ganada no puede volver a cambiar de etapa ni reabrirse; solo una perdida puede reabrirse", async () => {
    const ganadaId = await crearOportunidad(adminCookie, "Oportunidad que se gana");
    const cerrarGanada = await request(app.getHttpServer()).patch(`/api/v1/oportunidades/${ganadaId}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" });
    expect(cerrarGanada.status).toBe(200);
    expect(cerrarGanada.body.cerrada).toBe(true);

    // Cerrada: cambiarEtapa() debe rechazar cualquier otro movimiento hasta
    // que se reabra explícitamente.
    const cambiarDeNuevo = await request(app.getHttpServer())
      .patch(`/api/v1/oportunidades/${ganadaId}/etapa`)
      .set("Cookie", adminCookie)
      .send({ etapaClave: "perdida", motivoPerdidaClave: "sin_presupuesto" });
    expect(cambiarDeNuevo.status).toBe(409);

    // "Una oportunidad perdida puede reabrirse" (PLAN_CRM_DEFINITIVO.md) --
    // no dice nada de una ganada, así que reabrir() la rechaza a propósito.
    const reabrirGanada = await request(app.getHttpServer()).patch(`/api/v1/oportunidades/${ganadaId}/reabrir`).set("Cookie", adminCookie).send({ etapaClave: "negociacion" });
    expect(reabrirGanada.status).toBe(409);

    const perdidaId = await crearOportunidad(adminCookie, "Oportunidad que se pierde");
    const cerrarPerdida = await request(app.getHttpServer())
      .patch(`/api/v1/oportunidades/${perdidaId}/etapa`)
      .set("Cookie", adminCookie)
      .send({ etapaClave: "perdida", motivoPerdidaClave: "sin_presupuesto" });
    expect(cerrarPerdida.status).toBe(200);

    const reabrirPerdida = await request(app.getHttpServer()).patch(`/api/v1/oportunidades/${perdidaId}/reabrir`).set("Cookie", adminCookie).send({ etapaClave: "negociacion" });
    expect(reabrirPerdida.status).toBe(200);
    expect(reabrirPerdida.body.cerrada).toBe(false);
    expect(reabrirPerdida.body.etapa_clave).toBe("negociacion");
  });

  it("dos PATCH .../etapa concurrentes sobre la misma oportunidad abierta: solo uno gana, el otro recibe 409 (no se pisan en silencio)", async () => {
    const oportunidadId = await crearOportunidad(adminCookie, "Oportunidad disputada");

    const [resGanada, resPerdida] = await Promise.all([
      request(app.getHttpServer()).patch(`/api/v1/oportunidades/${oportunidadId}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" }),
      request(app.getHttpServer())
        .patch(`/api/v1/oportunidades/${oportunidadId}/etapa`)
        .set("Cookie", adminCookie)
        .send({ etapaClave: "perdida", motivoPerdidaClave: "sin_presupuesto" })
    ]);

    const statuses = [resGanada.status, resPerdida.status].sort();
    expect(statuses).toEqual([200, 409]);
  });

  it("no se puede vincular a una oportunidad un contacto que pertenece a OTRA empresa", async () => {
    const detalle = await request(app.getHttpServer()).get(`/api/v1/empresas/${empresaId}`).set("Cookie", adminCookie);
    const contactoId = detalle.body.contactos[0].id;

    const otraEmpresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Otra Empresa Distinta", contactos: [{ nombre: "Otro Contacto", correo: `otra.empresa.${Date.now()}@test.local` }] });
    expect(otraEmpresa.status).toBe(201);

    const res = await request(app.getHttpServer())
      .post("/api/v1/oportunidades")
      .set("Cookie", adminCookie)
      .send({ empresaId: otraEmpresa.body.id, contactoId, titulo: "Oportunidad con contacto cruzado" });
    expect(res.status).toBe(404);
  });

  it("GET /oportunidades filtra por empresaId (para la ficha de cliente); una empresa sin oportunidades responde una lista vacía, no 404", async () => {
    const propiaId = await crearOportunidad(adminCookie, "Oportunidad de esta empresa");

    const otraEmpresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Sin Oportunidades", contactos: [{ nombre: "Contacto", correo: `sin.oportunidades.${Date.now()}@test.local` }] });
    await crearOportunidad(adminCookie, "Oportunidad de otra empresa"); // esta usa la empresaId de beforeAll, no otraEmpresa

    const filtrada = await request(app.getHttpServer()).get(`/api/v1/oportunidades?empresaId=${empresaId}`).set("Cookie", adminCookie);
    expect(filtrada.status).toBe(200);
    expect(filtrada.body.data.every((o: { empresa_id: number }) => o.empresa_id === empresaId)).toBe(true);
    expect(filtrada.body.data.map((o: { id: number }) => o.id)).toContain(propiaId);

    const vacia = await request(app.getHttpServer()).get(`/api/v1/oportunidades?empresaId=${otraEmpresa.body.id}`).set("Cookie", adminCookie);
    expect(vacia.status).toBe(200);
    expect(vacia.body.data).toEqual([]);
  });
});
