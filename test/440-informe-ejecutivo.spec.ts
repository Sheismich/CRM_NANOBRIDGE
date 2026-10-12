import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { binario, textoDelPdf } from "./support/pdf.js";
import { auditoria, metricasComercialesDiarias, tareas } from "../src/database/schema.js";
import { parseCsv } from "../src/shared/csv.js";
import { diaAnterior, fechaMx } from "../src/shared/dia-habil.js";

// Informe ejecutivo (bloque 6, 12-oct-2026; diseño en
// docs/diseno/informe-ejecutivo.html): una hoja con el resumen del mes,
// conversión, forecast, prospección y desempeño por agente, comparado contra
// el mes anterior. Los números salen de los mismos reportes de
// /reportes/* (que ya tienen sus pruebas): aquí se revisa que el informe los
// junte bien, con los rangos del mes correctos.
describe("reportes: informe ejecutivo", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let agenteNombre: string;
  let empresaId: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const hoy = fechaMx(new Date());
  const mes = hoy.slice(0, 7);
  const primeroDelMes = `${mes}-01`;
  const ultimoDelMes = (m: string) => {
    const [anio, numero] = m.split("-").map(Number) as [number, number];
    return new Date(Date.UTC(anio, numero, 0)).toISOString().slice(0, 10);
  };
  const mesAnterior = diaAnterior(primeroDelMes).slice(0, 7);
  const rangoMes = { fechaInicio: primeroDelMes, fechaFin: ultimoDelMes(mes) };
  const rangoAnterior = { fechaInicio: `${mesAnterior}-01`, fechaFin: ultimoDelMes(mesAnterior) };

  function csv(query: Record<string, unknown>) {
    return api().get("/api/v1/reportes/export/informe-ejecutivo").set("Cookie", adminCookie).query({ formato: "csv", ...query });
  }

  // { "seccion/indicador": { valor, mes_anterior } }
  function renglones(texto: string) {
    const { encabezados, filas } = parseCsv(texto);
    expect(encabezados).toEqual(["seccion", "indicador", "valor", "mes_anterior"]);
    return Object.fromEntries(filas.map((f) => [`${f.seccion}/${f.indicador}`, { valor: f.valor, mes_anterior: f.mes_anterior }]));
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `informe.${Date.now()}@test.local`);
    const yo = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body;
    agenteId = yo.id;
    agenteNombre = yo.nombre;
    const emp = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Informe ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `informe.${randomUUID()}@test.local` }] });
    empresaId = emp.body.id;

    // Una ganada este mes, una abierta que cierra el mes que entra y una
    // tarea vencida, todo del agente nuevo.
    const ganada = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Ganada ${randomUUID()}`, responsableId: agenteId, valorEstimado: 96400 });
    expect(ganada.status).toBe(201);
    expect((await api().patch(`/api/v1/oportunidades/${ganada.body.id}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" })).status).toBe(200);
    const abierta = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Abierta ${randomUUID()}`, responsableId: agenteId, valorEstimado: 50000, fechaCierreEstimada: `${siguienteMesDe(mes)}-15` });
    expect(abierta.status).toBe(201);
    const tarea = await api().post("/api/v1/tareas").set("Cookie", adminCookie).send({ titulo: `Vencida ${randomUUID()}`, responsableId: agenteId, tipo: "seguimiento" });
    expect(tarea.status).toBe(201);
    await db.update(tareas).set({ fechaLimite: new Date(Date.now() - 86_400_000) }).where(eq(tareas.id, tarea.body.id));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("el CSV trae los mismos números que los reportes del mes y del mes anterior", async () => {
    const res = await csv({ responsableId: agenteId });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain(`attachment; filename="informe-ejecutivo-${mes}.csv"`);
    expect(res.text.startsWith("﻿")).toBe(true);
    const r = renglones(res.text);

    const filtro = { responsableId: agenteId };
    const get = async (ruta: string, query: Record<string, unknown>) => (await api().get(`/api/v1/reportes/${ruta}`).set("Cookie", adminCookie).query(query)).body;
    const pipeline = await get("pipeline/resumen", { ...filtro, ...rangoMes });
    const pipelineAnterior = await get("pipeline/resumen", { ...filtro, ...rangoAnterior });
    const tareasReporte = await get("tareas", { ...filtro, ...rangoMes });
    const prospeccion = await get("prospeccion", rangoMes);
    const prospeccionAnterior = await get("prospeccion", rangoAnterior);
    const conversion = await get("pipeline/conversion-etapas", { ...filtro, ...rangoMes });
    const desempeno = await get("desempeno-por-agente", { ...filtro, ...rangoMes });

    expect(r["resumen/pipeline_abierto"]).toEqual({ valor: pipeline.abiertas.valor_pipeline, mes_anterior: "" });
    expect(r["resumen/oportunidades_abiertas"]?.valor).toBe(String(pipeline.abiertas.cantidad));
    expect(r["resumen/ganado"]).toEqual({ valor: "96400.00", mes_anterior: pipelineAnterior.ganadas.ingresos_cerrados });
    expect(r["resumen/cierres"]).toEqual({ valor: "1", mes_anterior: String(pipelineAnterior.ganadas.cantidad) });
    expect(r["resumen/tareas_vencidas_hoy"]?.valor).toBe(String(tareasReporte.vencidas.total));
    expect(Number(r["resumen/tareas_vencidas_hoy"]?.valor)).toBeGreaterThanOrEqual(1);
    expect(r["resumen/tasa_respuesta_pct"]).toEqual({ valor: String(prospeccion.tasa_respuesta_pct ?? ""), mes_anterior: String(prospeccionAnterior.tasa_respuesta_pct ?? "") });

    const ganadaEtapa = conversion.etapas.find((e: { etapa_clave: string }) => e.etapa_clave === "ganada");
    expect(r["conversion/tasa_conversion_pct"]?.valor).toBe(String(ganadaEtapa?.conversion_desde_calificada_pct ?? ""));
    expect(r["conversion/ciclo_medio_dias"]?.valor).toBe(String(conversion.ciclo_medio_venta.dias ?? ""));
    for (const etapa of conversion.etapas) {
      expect(r[`conversion_etapa/${etapa.etapa_nombre}`]?.valor).toBe(String(etapa.oportunidades_alcanzadas));
    }

    expect(r["prospeccion/contactadas"]).toEqual({ valor: String(prospeccion.envios.personas_contactadas), mes_anterior: String(prospeccionAnterior.envios.personas_contactadas) });
    expect(r["prospeccion/respondieron"]).toEqual({ valor: String(prospeccion.respuestas.personas_que_respondieron), mes_anterior: String(prospeccionAnterior.respuestas.personas_que_respondieron) });

    // Forecast: cinco meses a partir del mes del informe, también los vacíos.
    const forecast = Object.keys(r).filter((k) => k.startsWith("forecast/") && k.endsWith("_total"));
    expect(forecast).toHaveLength(5);
    expect(forecast[0]).toBe(`forecast/${mes}_total`);
    expect(r[`forecast/${siguienteMesDe(mes)}_total`]?.valor).toBe("50000.00");
    expect(r[`forecast/${siguienteMesDe(mes)}_ponderado`]?.valor).toBeDefined();

    const fila = desempeno[0];
    expect(r[`agente/${agenteNombre} · ganado`]?.valor).toBe(fila.oportunidades.ingresos_cerrados);
    expect(r[`agente/${agenteNombre} · tareas_cerradas`]?.valor).toBe(String(fila.tareas.cerradas));
    expect(r[`agente/${agenteNombre} · vencidas`]?.valor).toBe(String(fila.tareas.vencidas));
    expect(r[`agente/${agenteNombre} · actividades`]?.valor).toBe(String(fila.actividades.total));
  });

  it("sin filtro de responsable, el pipeline se compara con la foto del último día del mes anterior", async () => {
    const fecha = ultimoDelMes(mesAnterior);
    await db.delete(metricasComercialesDiarias).where(eq(metricasComercialesDiarias.fecha, fecha));
    await db.insert(metricasComercialesDiarias).values({ fecha, oportunidadesAbiertas: 3, valorPipeline: "1084000.00", oportunidadesGanadas: 0, ingresosCerrados: "0.00", oportunidadesPerdidas: 0, valorPerdido: "0.00" });

    const r = renglones((await csv({})).text);
    const pipeline = (await api().get("/api/v1/reportes/pipeline/resumen").set("Cookie", adminCookie)).body;
    expect(r["resumen/pipeline_abierto"]).toEqual({ valor: pipeline.abiertas.valor_pipeline, mes_anterior: "1084000.00" });
  });

  it("las bajas del mes cuentan personas distintas que pidieron su baja, contra el mes anterior", async () => {
    const base = 900_000_000 + Math.floor(Math.random() * 1_000_000);
    const baja = (prospectoId: number, cuando: string) => db.insert(auditoria).values({ usuarioId: null, entidad: "prospecto", entidadId: prospectoId, accion: "cambiar_estado_automatizacion", antes: { estado: "validado" }, despues: { estado: "baja", motivo: "link" }, creadoEn: new Date(cuando) });
    await baja(base + 1, "2032-05-03T18:00:00Z");
    await baja(base + 1, "2032-05-04T18:00:00Z"); // la misma persona otra vez
    await baja(base + 2, "2032-05-31T23:30:00Z"); // 5:30 pm del 31 en México: sí es de mayo
    await baja(base + 3, "2032-06-01T05:00:00Z"); // 11 pm del 31 de mayo en México
    await baja(base + 4, "2032-04-20T18:00:00Z");

    const r = renglones((await csv({ mes: "2032-05" })).text);
    expect(r["prospeccion/bajas"]).toEqual({ valor: "3", mes_anterior: "1" });
  });

  it("el PDF es una hoja carta con todas las secciones del diseño", async () => {
    const res = await api().get("/api/v1/reportes/export/informe-ejecutivo").set("Cookie", adminCookie)
      .query({ responsableId: agenteId }).buffer(true).parse(binario);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain(`attachment; filename="informe-ejecutivo-${mes}.pdf"`);
    const hojas = await textoDelPdf(res.body as Buffer);
    expect(hojas).toHaveLength(1);
    const texto = hojas[0]!;
    for (const esperado of ["NANOBRIDGE", "Informe ejecutivo", "RESUMEN DEL MES", "PIPELINE ABIERTO", "GANADO", "TASA DE RESPUESTA", "TAREAS VENCIDAS", "Tasa de conversión", "CONVERSIÓN POR ETAPA", "FORECAST DE CIERRE", "PROSPECCIÓN", "CONTACTADAS", "BAJAS", "DESEMPEÑO POR AGENTE", agenteNombre, "$96,400", `por ${SEED_ADMIN.nombre}`, "página 1 de 1"]) {
      expect(texto, esperado).toContain(esperado);
    }
    expect(texto).toContain(agenteNombre);
  });

  it("valida el mes y es solo para administración y supervisión", async () => {
    expect((await csv({ mes: "2026-13" })).status).toBe(400);
    expect((await csv({ formato: "xlsx" })).status).toBe(400);
    expect((await api().get("/api/v1/reportes/export/informe-ejecutivo").set("Cookie", agenteCookie)).status).toBe(403);
  });
});

function siguienteMesDe(mes: string) {
  const [anio, numero] = mes.split("-").map(Number) as [number, number];
  return numero === 12 ? `${anio + 1}-01` : `${anio}-${String(numero + 1).padStart(2, "0")}`;
}
