import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";

// Cubre ReportesService.calcularMetricasDelDia() (el job diario de
// métricas comerciales, PLAN_API_DEFINITIVO.md "Jobs internos") y
// historicoMetricasDiarias(). La tabla es un agregado GLOBAL (no por
// empresa/agente) que toda la suite comparte -- por eso las aserciones
// comparan DELTAS entre un "antes" y un "después" del mismo test, no
// conteos absolutos, para no depender de qué más haya creado otro archivo
// de prueba en el mismo contenedor MySQL.
describe("job diario de métricas comerciales", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    const empresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Métricas", contactos: [{ nombre: "Contacto Métricas", correo: `metricas.${Date.now()}@test.local` }] });
    expect(empresa.status).toBe(201);
    empresaId = empresa.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  type MetricaDiaria = {
    fecha: string;
    oportunidades_abiertas: number;
    valor_pipeline: string;
    oportunidades_ganadas: number;
    ingresos_cerrados: string;
    oportunidades_perdidas: number;
    valor_perdido: string;
  };

  async function calcular(): Promise<MetricaDiaria> {
    const res = await request(app.getHttpServer()).post("/api/v1/reportes/metricas-diarias/calcular").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    return res.body;
  }

  it("una oportunidad abierta nueva suma a abiertas/valor_pipeline; al ganarla, se mueve a ganadas/ingresos_cerrados del día", async () => {
    const antes = await calcular();

    const crearOp = await request(app.getHttpServer())
      .post("/api/v1/oportunidades")
      .set("Cookie", adminCookie)
      .send({ empresaId, titulo: "Oportunidad de métricas", valorEstimado: 1500 });
    expect(crearOp.status).toBe(201);
    const oportunidadId = crearOp.body.id;

    const despuesAbierta = await calcular();
    expect(despuesAbierta.oportunidades_abiertas).toBe(antes.oportunidades_abiertas + 1);
    expect(Number(despuesAbierta.valor_pipeline) - Number(antes.valor_pipeline)).toBeCloseTo(1500, 2);
    // Todavía no se ganó: ganadas/ingresos_cerrados del día sin cambios.
    expect(despuesAbierta.oportunidades_ganadas).toBe(antes.oportunidades_ganadas);

    const cerrar = await request(app.getHttpServer()).patch(`/api/v1/oportunidades/${oportunidadId}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" });
    expect(cerrar.status).toBe(200);

    const despuesGanada = await calcular();
    // Vuelve a la línea base de abiertas: ya se cerró.
    expect(despuesGanada.oportunidades_abiertas).toBe(antes.oportunidades_abiertas);
    expect(despuesGanada.oportunidades_ganadas).toBe(antes.oportunidades_ganadas + 1);
    expect(Number(despuesGanada.ingresos_cerrados) - Number(antes.ingresos_cerrados)).toBeCloseTo(1500, 2);
  });

  it("una oportunidad perdida hoy suma a oportunidades_perdidas/valor_perdido del día", async () => {
    const antes = await calcular();

    const crearOp = await request(app.getHttpServer())
      .post("/api/v1/oportunidades")
      .set("Cookie", adminCookie)
      .send({ empresaId, titulo: "Oportunidad que se pierde", valorEstimado: 800 });
    expect(crearOp.status).toBe(201);

    const perder = await request(app.getHttpServer())
      .patch(`/api/v1/oportunidades/${crearOp.body.id}/etapa`)
      .set("Cookie", adminCookie)
      .send({ etapaClave: "perdida", motivoPerdidaClave: "sin_presupuesto" });
    expect(perder.status).toBe(200);

    const despues = await calcular();
    expect(despues.oportunidades_perdidas).toBe(antes.oportunidades_perdidas + 1);
    expect(Number(despues.valor_perdido) - Number(antes.valor_perdido)).toBeCloseTo(800, 2);
  });

  it("GET /reportes/metricas-diarias incluye la fila de hoy con lo último calculado, y respeta el rango de fechas", async () => {
    const calculado = await calcular();

    const historico = await request(app.getHttpServer()).get("/api/v1/reportes/metricas-diarias").set("Cookie", adminCookie);
    expect(historico.status).toBe(200);
    const filaHoy = (historico.body as MetricaDiaria[]).find((f) => f.fecha === calculado.fecha);
    expect(filaHoy).toBeDefined();
    expect(filaHoy?.oportunidades_abiertas).toBe(calculado.oportunidades_abiertas);

    // Un rango que empieza "mañana" no debe incluir la fila de hoy.
    const [anio, mes, dia] = calculado.fecha.split("-").map(Number);
    const manana = new Date(Date.UTC(anio!, mes! - 1, dia! + 1)).toISOString().slice(0, 10);
    const sinHoy = await request(app.getHttpServer()).get(`/api/v1/reportes/metricas-diarias?fechaInicio=${manana}`).set("Cookie", adminCookie);
    expect(sinHoy.status).toBe(200);
    expect((sinHoy.body as MetricaDiaria[]).find((f) => f.fecha === calculado.fecha)).toBeUndefined();
  });
});
