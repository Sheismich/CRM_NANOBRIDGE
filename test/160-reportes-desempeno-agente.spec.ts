import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// GET /reportes/desempeno-por-agente: junta actividades + tareas cerradas/
// vencidas + oportunidades ganadas/ingresos por agente en UNA sola llamada,
// sin que el cliente tenga que pedirlo agente por agente contra /actividades,
// /tareas y /pipeline/resumen (ver el comentario largo en
// ReportesService.desempenoPorAgente).
describe("reportes: desempeño por agente", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agente1: { cookie: string[]; id: number };
  let agente2: { cookie: string[]; id: number };
  let empresaId: number;
  const sufijo = Date.now();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    const a1Cookie = await crearAgente(app, adminCookie, `desempeno.a1.${sufijo}@test.local`);
    const a2Cookie = await crearAgente(app, adminCookie, `desempeno.a2.${sufijo}@test.local`);
    agente1 = { cookie: a1Cookie, id: await idDe(a1Cookie) };
    agente2 = { cookie: a2Cookie, id: await idDe(a2Cookie) };

    // Propiedad de agente1: registrar una actividad exige ser dueño de la
    // empresa (ActividadesService.crear) o administrador/supervisor -- una
    // empresa del admin no serviría para probar que las actividades de
    // agente1 se agrupan bien.
    const empresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", agente1.cookie)
      .send({ nombreLegal: `Empresa Desempeño ${sufijo}`, contactos: [{ nombre: "Contacto Desempeño", correo: `desempeno.contacto.${sufijo}@test.local` }] });
    expect(empresa.status).toBe(201);
    empresaId = empresa.body.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function idDe(cookie: string[]) {
    const res = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", cookie);
    return res.body.id as number;
  }

  async function registrarActividad(cookie: string[], tipo: "llamada" | "whatsapp" | "comentario") {
    const res = await request(app.getHttpServer()).post("/api/v1/actividades").set("Cookie", cookie).send({ empresaId, tipo, comentario: "prueba" });
    expect(res.status).toBe(201);
  }

  async function crearYCerrarTarea(cookie: string[], responsableId: number) {
    const crear = await request(app.getHttpServer()).post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: "Tarea de prueba", responsableId });
    expect(crear.status).toBe(201);
    const cerrar = await request(app.getHttpServer()).patch(`/api/v1/tareas/${crear.body.id}/cerrar`).set("Cookie", cookie).send({ resultado: "hecho" });
    expect(cerrar.status).toBe(200);
  }

  async function crearOportunidadGanada(cookie: string[]) {
    const crear = await request(app.getHttpServer()).post("/api/v1/oportunidades").set("Cookie", cookie).send({ empresaId, titulo: `Oportunidad ${Math.random()}`, valorEstimado: 1000 });
    expect(crear.status).toBe(201);
    const ganar = await request(app.getHttpServer()).patch(`/api/v1/oportunidades/${crear.body.id}/etapa`).set("Cookie", cookie).send({ etapaClave: "ganada" });
    expect(ganar.status).toBe(200);
  }

  function pedir(query: string, cookie = adminCookie) {
    return request(app.getHttpServer()).get(`/api/v1/reportes/desempeno-por-agente${query}`).set("Cookie", cookie);
  }

  it("une actividades, tareas y oportunidades ganadas de cada agente en una sola fila por agente", async () => {
    await registrarActividad(agente1.cookie, "llamada");
    await registrarActividad(agente1.cookie, "llamada");
    await registrarActividad(agente1.cookie, "whatsapp");
    await crearYCerrarTarea(agente1.cookie, agente1.id);
    await crearOportunidadGanada(agente1.cookie);

    const res = await pedir("");
    expect(res.status).toBe(200);

    const fila1 = res.body.find((f: { responsable_id: number }) => f.responsable_id === agente1.id);
    expect(fila1).toMatchObject({
      responsable_id: agente1.id,
      actividades: { llamada: 2, whatsapp: 1, comentario: 0, total: 3 },
      tareas: { cerradas: 1, vencidas: 0 },
      oportunidades: { ganadas: 1, ingresos_cerrados: "1000.00" }
    });
  });

  it("un agente sin ninguna actividad en el rango sigue apareciendo en la tabla, con todo en cero", async () => {
    const res = await pedir("");
    expect(res.status).toBe(200);

    const fila2 = res.body.find((f: { responsable_id: number }) => f.responsable_id === agente2.id);
    expect(fila2).toMatchObject({
      responsable_id: agente2.id,
      actividades: { llamada: 0, whatsapp: 0, comentario: 0, total: 0 },
      tareas: { cerradas: 0, vencidas: 0 },
      oportunidades: { ganadas: 0, ingresos_cerrados: "0.00" }
    });
  });

  it("responsableId acota la tabla a un solo agente", async () => {
    const res = await pedir(`?responsableId=${agente1.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].responsable_id).toBe(agente1.id);
  });

  it("un responsableId que no es agente (ej. el administrador) devuelve una lista vacía", async () => {
    const me = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    const res = await pedir(`?responsableId=${me.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("el rango de fechas se aplica a actividades y a tareas cerradas: fuera de rango, esas métricas caen a cero", async () => {
    const futuro = "2099-01-01";
    const res = await pedir(`?responsableId=${agente1.id}&fechaInicio=${futuro}&fechaFin=${futuro}`);
    expect(res.status).toBe(200);
    expect(res.body[0].actividades.total).toBe(0);
    expect(res.body[0].tareas.cerradas).toBe(0);
  });

  it("un agente y un usuario sin sesión no pueden ver el reporte", async () => {
    expect((await pedir("", agente1.cookie)).status).toBe(403);
    expect((await request(app.getHttpServer()).get("/api/v1/reportes/desempeno-por-agente")).status).toBe(401);
  });

  it("se puede exportar como CSV, con una columna por métrica", async () => {
    const res = await request(app.getHttpServer()).get(`/api/v1/reportes/export/desempeno-por-agente?responsableId=${agente1.id}`).set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    // toCsv() antepone un BOM UTF-8 a propósito (para que Excel detecte la
    // codificación) -- se quita antes de comparar el encabezado.
    const primeraLinea = res.text.replace(/^﻿/, "").split(/\r?\n/)[0];
    expect(primeraLinea).toBe(
      "responsable_id,responsable_nombre,actividades_llamada,actividades_whatsapp,actividades_comentario,actividades_total,tareas_cerradas,tareas_vencidas,oportunidades_ganadas,oportunidades_ingresos_cerrados"
    );
    expect(res.text).toContain("2,1,0,3,1,0,1,1000.00");
  });
});
