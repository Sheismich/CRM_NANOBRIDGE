import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { catalogoEtapaEmbudo, historialEtapaOportunidad, oportunidades } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";

// Oportunidades nuevas (tablero + embudo, 9-oct-2026): cada tarjeta dice
// cuántos días lleva en su etapa y de quién es; el resumen cuenta lo que
// cierra este mes y lo que ya pasó su fecha de cierre sin cerrarse.
describe("oportunidades: días en etapa y cierres del mes / vencidos", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let agenteId: number;
  let empresaId: number;
  let opVencida: number;
  let opEsteMes: number;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const hoy = fechaMx(new Date());

  function sumarDias(fecha: string, dias: number) {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  }

  async function crearOportunidad(titulo: string, valor: number, fechaCierre: string) {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", agenteCookie).send({ empresaId, titulo, valorEstimado: valor, fechaCierreEstimada: fechaCierre });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    agenteCookie = await crearAgente(app, adminCookie, `opor.dias.${Date.now()}@test.local`);
    agenteId = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body.id;
    const emp = await api().post("/api/v1/empresas").set("Cookie", agenteCookie).send({ nombreLegal: `Empresa días ${Date.now()}`, contactos: [{ nombre: "Contacto", correo: `opd.${Date.now()}@test.local` }] });
    empresaId = emp.body.id;

    opVencida = await crearOportunidad("Vencida", 1000, sumarDias(hoy, -40));
    // "Este mes": el día 1 del mes en curso nunca es vencido mañana... se usa
    // el último día del mes, que siempre es >= hoy.
    const [anio, mes] = hoy.split("-").map(Number);
    const ultimoDia = new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
    opEsteMes = await crearOportunidad("Este mes", 2500, ultimoDia);

    // La vencida lleva 12 días (y una hora) en su etapa. La hora de margen es
    // porque MySQL redondea al segundo y "exactamente 12 días" a veces quedaba
    // unos milisegundos debajo y salían 11.
    await db.update(historialEtapaOportunidad).set({ creadoEn: new Date(Date.now() - 12 * 86_400_000 - 3_600_000) }).where(eq(historialEtapaOportunidad.oportunidadId, opVencida));
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("cada tarjeta trae cuántos días lleva en su etapa y el nombre del responsable", async () => {
    const res = await api().get("/api/v1/oportunidades").set("Cookie", adminCookie).query({ empresaId });
    const vencida = res.body.data.find((o: { id: number }) => o.id === opVencida);
    expect(vencida.dias_en_etapa).toBe(12);
    expect(vencida.etapa_desde).toBeTruthy();
    expect(vencida.responsable_nombre).toBe("Agente de prueba");
    const esteMes = res.body.data.find((o: { id: number }) => o.id === opEsteMes);
    expect(esteMes.dias_en_etapa).toBe(0);
  });

  it("el resumen cuenta lo que cierra este mes y lo vencido sin cerrar", async () => {
    const res = await api().get("/api/v1/reportes/pipeline/resumen").set("Cookie", adminCookie).query({ responsableId: agenteId });
    expect(res.status).toBe(200);
    expect(res.body.cierre_este_mes).toEqual({ cantidad: 1, valor: "2500.00" });
    expect(res.body.cierre_vencido).toEqual({ cantidad: 1, valor: "1000.00" });
  });

  // Inicio (13-oct-2026): la tarjeta "Pipeline abierto" dice cuánto vale el
  // pipeline ponderado (valor × probabilidad de su etapa). Cuenta TODAS las
  // abiertas, también las que no tienen fecha de cierre (el forecast las
  // deja fuera porque reparte por mes).
  it("abiertas trae el valor ponderado, también de las que no tienen fecha de cierre", async () => {
    const sinFecha = await api().post("/api/v1/oportunidades").set("Cookie", agenteCookie).send({ empresaId, titulo: "Sin fecha", valorEstimado: 400 });
    expect(sinFecha.status).toBe(201);
    const [{ probabilidad }] = await db
      .select({ probabilidad: catalogoEtapaEmbudo.probabilidad })
      .from(oportunidades)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(eq(oportunidades.id, sinFecha.body.id));

    const res = await api().get("/api/v1/reportes/pipeline/resumen").set("Cookie", adminCookie).query({ responsableId: agenteId });
    expect(res.body.abiertas.cantidad).toBe(3);
    expect(Number(res.body.abiertas.valor_ponderado)).toBeCloseTo(((1000 + 2500 + 400) * Number(probabilidad)) / 100, 2);
    await db.update(oportunidades).set({ cerrada: true }).where(eq(oportunidades.id, sinFecha.body.id));
  });

  // Inicio (ajuste del 11-oct): "ganadas y perdidas del mes" = el mismo
  // resumen con el rango del mes; lo cerrado antes del día 1 no entra.
  it("con el rango del mes, ganadas y perdidas cuentan solo lo cerrado este mes", async () => {
    const delMes = { responsableId: agenteId, fechaInicio: `${hoy.slice(0, 7)}-01`, fechaFin: hoy };
    const antes = (await api().get("/api/v1/reportes/pipeline/resumen").set("Cookie", adminCookie).query(delMes)).body;
    const futura = sumarDias(hoy, 60);
    const ganada = await crearOportunidad("Ganada", 3000, futura);
    const perdida = await crearOportunidad("Perdida", 700, futura);
    const ganadaViejita = await crearOportunidad("Ganada hace 40 días", 9000, futura);
    expect((await api().patch(`/api/v1/oportunidades/${ganada}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" })).status).toBe(200);
    expect((await api().patch(`/api/v1/oportunidades/${perdida}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "perdida", motivoPerdidaClave: "sin_presupuesto" })).status).toBe(200);
    expect((await api().patch(`/api/v1/oportunidades/${ganadaViejita}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" })).status).toBe(200);
    await db.update(oportunidades).set({ actualizadoEn: new Date(Date.now() - 40 * 86_400_000) }).where(eq(oportunidades.id, ganadaViejita));

    const despues = (await api().get("/api/v1/reportes/pipeline/resumen").set("Cookie", adminCookie).query(delMes)).body;
    expect(despues.ganadas.cantidad - antes.ganadas.cantidad).toBe(1);
    expect(Number(despues.ganadas.ingresos_cerrados) - Number(antes.ganadas.ingresos_cerrados)).toBeCloseTo(3000, 2);
    expect(despues.perdidas.cantidad - antes.perdidas.cantidad).toBe(1);
    expect(Number(despues.perdidas.valor_perdido) - Number(antes.perdidas.valor_perdido)).toBeCloseTo(700, 2);
  });

  it("una oportunidad cerrada ya no cuenta como vencida", async () => {
    await db.update(oportunidades).set({ cerrada: true }).where(eq(oportunidades.id, opVencida));
    const res = await api().get("/api/v1/reportes/pipeline/resumen").set("Cookie", adminCookie).query({ responsableId: agenteId });
    expect(res.body.cierre_vencido).toEqual({ cantidad: 0, valor: "0.00" });
  });
});
