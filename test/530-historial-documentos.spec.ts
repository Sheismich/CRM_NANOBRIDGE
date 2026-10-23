import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { documentos } from "../src/database/schema.js";
import { IA_SERVICE } from "../src/integraciones/ia.types.js";
import type { IaFalsaDriver } from "../src/integraciones/ia-falsa.driver.js";

// Documentos en el Historial de la ficha (23-oct-2026, PLAN_CRM_DEFINITIVO.md
// #4: "Documentos enviados" y "Confirmaciones de revisión"). Se leen de la
// tabla documentos, sin copiar nada: cada versión subida es un evento y su
// revisión (aprobado o rechazado), otro.
describe("documentos en el historial", () => {
  let app: INestApplication;
  let admin: string[];
  let adminId: number;
  let ia: IaFalsaDriver;
  let tipo: { id: number; nombre: string };
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const historial = async (empresaId: number, extra: Record<string, number> = {}) => {
    const res = await api().get("/api/v1/actividades").query({ empresaId, limit: 100, ...extra }).set("Cookie", admin);
    expect(res.status).toBe(200);
    return res.body.data as { tipo: string; fecha: string; responsable_id: number | null; resultado: string | null; detalle: Record<string, unknown> }[];
  };
  const deDocumentos = (eventos: Awaited<ReturnType<typeof historial>>) => eventos.filter((e) => e.tipo.startsWith("documento_"));

  async function empresa() {
    const res = await api().post("/api/v1/empresas").set("Cookie", admin).send({ nombreLegal: `Historial docs ${randomUUID().slice(0, 8)}`, contactos: [{ nombre: "Rosa Peña", correo: `rosa.${randomUUID()}@cliente.test` }] });
    expect(res.status).toBe(201);
    const ficha = await api().get(`/api/v1/empresas/${res.body.id}`).set("Cookie", admin);
    return { empresaId: res.body.id as number, contactoId: ficha.body.contactos[0].id as number };
  }

  async function subir(empresaId: number, nombre: string, extra: Record<string, string> = {}) {
    let req = api().post("/api/v1/documentos").set("Cookie", admin).field("empresaId", String(empresaId)).field("tipoDocumentoId", String(tipo.id));
    for (const [k, v] of Object.entries(extra)) req = req.field(k, v);
    const res = await req.attach("archivo", Buffer.from("%PDF-1.4 prueba"), { filename: nombre, contentType: "application/pdf" });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  beforeAll(async () => {
    app = await createTestApp();
    ia = app.get(IA_SERVICE);
    admin = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", admin)).body.id;
    const catalogos = await api().get("/api/v1/documentos/catalogos").set("Cookie", admin);
    tipo = catalogos.body.tipos_documento[0];
  });

  beforeEach(() => {
    ia.fallar = false;
    ia.respuesta = { resumen: "Resumen de prueba.", siguiente_paso: "Llamarle." };
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("subir un documento aparece como 'documento_subido' con su tipo, nombre, versión y quién lo subió", async () => {
    const { empresaId } = await empresa();
    const id = await subir(empresaId, "constancia.pdf");
    const [evento] = deDocumentos(await historial(empresaId));
    expect(evento).toEqual(
      expect.objectContaining({
        tipo: "documento_subido",
        responsable_id: adminId,
        resultado: null,
        detalle: expect.objectContaining({ documento_id: id, tipo_nombre: tipo.nombre, nombre: "constancia.pdf", version: 1, usuario_nombre: expect.any(String) })
      })
    );
  });

  it("mientras está por revisar no hay evento de revisión; al rechazar sale con el motivo, y si luego se aprueba, cambia", async () => {
    const { empresaId } = await empresa();
    const id = await subir(empresaId, "acta.pdf");
    expect(deDocumentos(await historial(empresaId)).map((e) => e.tipo)).toEqual(["documento_subido"]);

    expect((await api().patch(`/api/v1/documentos/${id}/rechazar`).set("Cookie", admin).send({ motivoRechazo: "ilegible", motivoRechazoDetalle: "El sello no se lee" })).status).toBe(200);
    let revisado = deDocumentos(await historial(empresaId)).find((e) => e.tipo === "documento_revisado");
    expect(revisado).toEqual(
      expect.objectContaining({
        responsable_id: adminId,
        resultado: "rechazado",
        detalle: expect.objectContaining({ documento_id: id, tipo_nombre: tipo.nombre, nombre: "acta.pdf", motivo: "Ilegible o borroso", motivo_detalle: "El sello no se lee" })
      })
    );

    expect((await api().patch(`/api/v1/documentos/${id}/aprobar`).set("Cookie", admin).send({})).status).toBe(200);
    const eventos = deDocumentos(await historial(empresaId));
    revisado = eventos.find((e) => e.tipo === "documento_revisado");
    expect(eventos.filter((e) => e.tipo === "documento_revisado")).toHaveLength(1);
    expect(revisado).toEqual(expect.objectContaining({ resultado: "aprobado", detalle: expect.objectContaining({ motivo: null, motivo_detalle: null }) }));
  });

  it("cada versión nueva es otro 'documento_subido'", async () => {
    const { empresaId } = await empresa();
    const id = await subir(empresaId, "contrato.pdf");
    const res = await api().post(`/api/v1/documentos/${id}/version`).set("Cookie", admin).attach("archivo", Buffer.from("%PDF-1.4 v2"), { filename: "contrato-v2.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(201);
    const subidos = deDocumentos(await historial(empresaId)).filter((e) => e.tipo === "documento_subido");
    expect(subidos.map((e) => e.detalle.version).sort()).toEqual([1, 2]);
  });

  it("un documento eliminado ya no sale", async () => {
    const { empresaId } = await empresa();
    const id = await subir(empresaId, "borrado.pdf");
    await db.update(documentos).set({ activo: false }).where(eq(documentos.id, id));
    expect(deDocumentos(await historial(empresaId))).toEqual([]);
  });

  it("con el filtro de contacto, solo los documentos de ese contacto", async () => {
    const { empresaId, contactoId } = await empresa();
    await subir(empresaId, "de-rosa.pdf", { contactoId: String(contactoId) });
    await subir(empresaId, "de-la-empresa.pdf");
    const nombres = deDocumentos(await historial(empresaId, { contactoId })).map((e) => e.detalle.nombre);
    expect(nombres).toEqual(["de-rosa.pdf"]);
    expect(deDocumentos(await historial(empresaId))).toHaveLength(2);
  });

  it("al resumen con IA le llega el tipo y el resultado, sin el nombre del archivo ni la explicación del rechazo", async () => {
    const { empresaId } = await empresa();
    const id = await subir(empresaId, "INE Rosa Peña Hernández.pdf");
    expect((await api().patch(`/api/v1/documentos/${id}/rechazar`).set("Cookie", admin).send({ motivoRechazo: "vencido", motivoRechazoDetalle: "Vence el 3 de marzo, CURP PEHR800101" })).status).toBe(200);
    expect((await api().post(`/api/v1/empresas/${empresaId}/resumen-ia`).set("Cookie", admin).send({})).status).toBe(201);
    const texto = ia.preguntas.at(-1)!.texto;
    expect(texto).toContain(`Se subió ${tipo.nombre}`);
    expect(texto).toContain(`${tipo.nombre} rechazado: Vencido`);
    expect(texto).not.toContain("Rosa Peña Hernández");
    // Tampoco por la tarea automática "Corregir documento: <archivo>".
    expect(texto).toContain("Corregir documento: [archivo]");
    expect(texto).not.toContain("PEHR800101");
  });
});
