import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, SEED_ADMIN } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { binario, textoDelPdf } from "./support/pdf.js";
import { auditoria } from "../src/database/schema.js";
import { fechaMx } from "../src/shared/dia-habil.js";
import { caidaMaxima, cambioPct, cambioPuntos, fraseConversion, fraseDesempeno, fraseForecast, fraseProspeccion, fraseTareas, rangosDelPeriodo } from "../src/reportes/frases.js";

// Reporte del periodo (16-oct-2026): el PDF de "Exportar" en Reportes ya no
// es el informe ejecutivo del mes, sino lo que se ve en el panel (periodo
// hasta hoy contra el mismo tramo anterior, con sus frases). Las frases y
// los rangos son los de la pantalla (frontend/src/lib/reportes.ts).
describe("reportes: reporte del periodo", () => {
  describe("rangos del periodo (igual que la pantalla)", () => {
    it("mes, trimestre, semana y año van hasta hoy contra el mismo tramo anterior", () => {
      // 16-oct-2026 es viernes.
      expect(rangosDelPeriodo("mes", "2026-10-16")).toEqual(expect.objectContaining({
        actual: { fechaInicio: "2026-10-01", fechaFin: "2026-10-16" },
        anterior: { fechaInicio: "2026-09-01", fechaFin: "2026-09-16" },
        contra: "sep",
        titulo: "octubre"
      }));
      expect(rangosDelPeriodo("trimestre", "2026-10-16")).toEqual(expect.objectContaining({
        actual: { fechaInicio: "2026-10-01", fechaFin: "2026-10-16" },
        anterior: { fechaInicio: "2026-07-01", fechaFin: "2026-07-16" },
        titulo: "oct–dic"
      }));
      expect(rangosDelPeriodo("semana", "2026-10-16")).toEqual(expect.objectContaining({
        actual: { fechaInicio: "2026-10-12", fechaFin: "2026-10-16" },
        anterior: { fechaInicio: "2026-10-05", fechaFin: "2026-10-09" },
        contra: "la semana pasada",
        contraCorto: "sem. pasada"
      }));
      expect(rangosDelPeriodo("anio", "2026-10-16")).toEqual(expect.objectContaining({
        actual: { fechaInicio: "2026-01-01", fechaFin: "2026-10-16" },
        anterior: { fechaInicio: "2025-01-01", fechaFin: "2025-10-16" },
        contra: "2025"
      }));
    });

    it("si el mes anterior es más corto, el tramo anterior termina en su último día", () => {
      expect(rangosDelPeriodo("mes", "2026-03-31").anterior).toEqual({ fechaInicio: "2026-02-01", fechaFin: "2026-02-28" });
    });
  });

  describe("frases (igual que la pantalla)", () => {
    const etapas = [
      { etapa_clave: "calificada", etapa_nombre: "Calificada", orden: 1, oportunidades_alcanzadas: 8, conversion_desde_calificada_pct: 100 },
      { etapa_clave: "propuesta", etapa_nombre: "Propuesta", orden: 3, oportunidades_alcanzadas: 6, conversion_desde_calificada_pct: 75 },
      { etapa_clave: "negociacion", etapa_nombre: "Negociación", orden: 4, oportunidades_alcanzadas: 3, conversion_desde_calificada_pct: 37.5 },
      { etapa_clave: "ganada", etapa_nombre: "Ganada", orden: 6, oportunidades_alcanzadas: 2, conversion_desde_calificada_pct: 25 }
    ];

    it("conversión, caída máxima, forecast, prospección, tareas y desempeño", () => {
      expect(fraseConversion({ base_calificadas: 8, etapas })).toBe("De cada 4 oportunidades calificadas, 1 se cierra con éxito (25% de tasa neta).");
      expect(fraseConversion({ base_calificadas: 0, etapas: [] })).toBe("Todavía no hay oportunidades calificadas en este periodo.");
      expect(caidaMaxima({ etapas })).toBe("de Propuesta a Negociación (−38%)");
      expect(fraseForecast([{ mes: "2026-10", valor_estimado_total: "300000.00", valor_ponderado: "90000.00" }, { mes: "2026-11", valor_estimado_total: "100000.00", valor_ponderado: "10000.00" }]))
        .toBe("Octubre concentra el 75% de lo esperado: $400K en total, $100K ponderado.");
      expect(fraseProspeccion([{ fecha: "2026-10-14", envios: 5, respuestas: 1 }, { fecha: "2026-10-15", envios: 4, respuestas: 3 }])).toBe("El mejor día de respuestas fue el jueves 15 de octubre, con 3.");
      expect(fraseProspeccion([{ fecha: "2026-10-14", envios: 5, respuestas: 0 }])).toBe("Salieron 5 correos y todavía no hay respuestas.");
      expect(fraseTareas({ creadas: { total: 4, por_tipo: [{ tipo: "seguimiento", cantidad: 3 }, { tipo: "otro", cantidad: 1 }] } })).toBe("El 75% de las tareas del periodo son de seguimiento.");
      expect(fraseDesempeno([
        { responsable_id: 1, responsable_nombre: "Ana López", actividades: { total: 12 }, tareas: { vencidas: 0 }, oportunidades: { ganadas: 1 } },
        { responsable_id: 2, responsable_nombre: "Beto Ruiz", actividades: { total: 5 }, tareas: { vencidas: 2 }, oportunidades: { ganadas: 0 } }
      ])).toBe("Ana lleva el volumen (12 actividades) y el único cierre; Ana no tiene tareas vencidas.");
    });

    it("las comparaciones dicen hacia dónde va y si es bueno", () => {
      expect(cambioPct(118, 100, "sep")).toEqual({ texto: "18% vs sep", sentido: "arriba", bueno: true });
      expect(cambioPct(80, 100, "sep")).toEqual({ texto: "20% vs sep", sentido: "abajo", bueno: false });
      expect(cambioPct(5, 0, "sep")).toEqual({ texto: "nuevo vs sep", sentido: "arriba", bueno: true });
      expect(cambioPct(0, 0, "sep")).toEqual({ texto: "igual que sep", sentido: null, bueno: null });
      expect(cambioPuntos(12.5, 9.8, "sep")).toEqual({ texto: "2.7 pts vs sep", sentido: "arriba", bueno: true });
    });
  });

  describe("el PDF", () => {
    let app: INestApplication;
    let adminCookie: string[];
    let agenteCookie: string[];
    let agenteId: number;
    let agenteNombre: string;
    const db = testDb();
    const api = () => request(app.getHttpServer());
    const hoy = fechaMx(new Date());

    beforeAll(async () => {
      app = await createTestApp();
      adminCookie = await ensureSeedAdmin(app);
      agenteCookie = await crearAgente(app, adminCookie, `periodo.${Date.now()}@test.local`);
      const yo = (await api().get("/api/v1/auth/me").set("Cookie", agenteCookie)).body;
      agenteId = yo.id;
      agenteNombre = yo.nombre;
    });

    afterAll(async () => {
      await app.close();
      await closeTestDb();
    });

    const pdf = (query: Record<string, unknown>) => api().get("/api/v1/reportes/export/periodo").set("Cookie", adminCookie).query(query).buffer(true).parse(binario);

    it("trae las secciones del panel, con su periodo, y queda en el Registro de cambios", async () => {
      const res = await pdf({ periodo: "trimestre" });
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/pdf");
      expect(res.headers["content-disposition"]).toContain(`attachment; filename="reporte-trimestre-${hoy}.pdf"`);
      const texto = (await textoDelPdf(res.body as Buffer)).join(" ");
      for (const esperado of ["NANOBRIDGE", "Reporte del periodo", "Trimestre", "contra el trimestre anterior", "Todos los responsables", "INDICADORES", "PIPELINE ABIERTO", "GANADO", "TASA DE RESPUESTA", "ACTIVIDADES", "TAREAS VENCIDAS", "CONVERSIÓN POR ETAPA", "FORECAST DE CIERRE", "PROSPECCIÓN", "CORREOS ENVIADOS", "TAREAS POR TIPO", "DESEMPEÑO POR AGENTE", agenteNombre, `por ${SEED_ADMIN.nombre}`]) {
        expect(texto, esperado).toContain(esperado);
      }

      const [fila] = await db.select({ despues: auditoria.despues }).from(auditoria)
        .where(and(eq(auditoria.entidad, "reporte"), eq(auditoria.accion, "exportar")))
        .orderBy(desc(auditoria.id)).limit(1);
      expect(fila?.despues).toEqual({ reporte: "periodo", formato: "pdf", filtros: { periodo: "trimestre", responsableId: null } });
    });

    it("sin periodo es el mes; con responsable lo dice y aclara la prospección", async () => {
      const mes = await pdf({});
      expect(mes.status).toBe(200);
      expect(mes.headers["content-disposition"]).toContain(`reporte-mes-${hoy}.pdf`);

      const conAgente = await pdf({ periodo: "semana", responsableId: agenteId });
      expect(conAgente.status).toBe(200);
      const texto = (await textoDelPdf(conAgente.body as Buffer)).join(" ");
      expect(texto).toContain(`Responsable: ${agenteNombre}`);
      expect(texto).toContain("Esta semana");
      expect(texto).toContain("los correos los manda la automatización");
    });

    it("valida el periodo y es solo para administración y supervisión", async () => {
      expect((await api().get("/api/v1/reportes/export/periodo").set("Cookie", adminCookie).query({ periodo: "dia" })).status).toBe(400);
      expect((await api().get("/api/v1/reportes/export/periodo").set("Cookie", agenteCookie)).status).toBe(403);
    });
  });
});
