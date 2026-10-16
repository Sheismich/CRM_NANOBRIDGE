import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, desc, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, empresas } from "../src/database/schema.js";

// Papeles obligatorios por venta (16-oct-2026): cada oportunidad pide
// cotización, comprobante de pago y comprobante de recibido o guía; si lleva
// factura, también la constancia de situación fiscal, que es de la empresa
// (una aprobada sirve para todas sus ventas). La cotización aceptada del CRM
// cuenta sola. Un papel cuenta solo aprobado. Solo las ganadas cuentan como
// expedientes incompletos.
type Papel = { clave: string; estado: string; origen: string | null; documento: { id: number } | null; cotizacion: { id: number } | null };
type Venta = { oportunidad_id: number; titulo: string; ganada: boolean; lleva_factura: boolean; papeles: Papel[]; aprobados: number; total: number; completo: boolean };

describe("expediente por venta", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const tipos: Record<string, number> = {};
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function usuarioId(cookie: string[]) {
    return (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number;
  }

  async function empresaDe(propietarioId: number) {
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Expediente ${randomUUID().slice(0, 8)}`, contactos: [{ nombre: "Contacto", correo: `exp.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    await db.update(empresas).set({ propietarioId }).where(eq(empresas.id, res.body.id));
    return res.body.id as number;
  }

  async function oportunidad(empresaId: number, responsableId: number, extra: Record<string, unknown> = {}) {
    const res = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId, titulo: `Venta ${randomUUID().slice(0, 6)}`, responsableId, ...extra });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function etapa(id: number, etapaClave: string) {
    const res = await api().patch(`/api/v1/oportunidades/${id}/etapa`).set("Cookie", adminCookie).send({ etapaClave, ...(etapaClave === "perdida" ? { motivoPerdidaClave: "sin_presupuesto" } : {}) });
    expect(res.status).toBe(200);
  }

  function subirReq(cookie: string[], empresaId: number, clave: string | null, oportunidadId?: number) {
    let req = api().post("/api/v1/documentos").set("Cookie", cookie).field("empresaId", String(empresaId));
    if (clave) req = req.field("tipoDocumentoId", String(tipos[clave]));
    if (oportunidadId) req = req.field("oportunidadId", String(oportunidadId));
    return req.attach("archivo", Buffer.from("%PDF-1.4 prueba"), { filename: `${randomUUID().slice(0, 6)}.pdf`, contentType: "application/pdf" });
  }

  async function subir(cookie: string[], empresaId: number, clave: string, oportunidadId?: number) {
    const res = await subirReq(cookie, empresaId, clave, oportunidadId);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function aprobar(id: number) {
    expect((await api().patch(`/api/v1/documentos/${id}/aprobar`).set("Cookie", adminCookie).send({})).status).toBe(200);
  }

  async function aprobado(cookie: string[], empresaId: number, clave: string, oportunidadId?: number) {
    const id = await subir(cookie, empresaId, clave, oportunidadId);
    await aprobar(id);
    return id;
  }

  async function cotizacionAceptada(empresaId: number, oportunidadId: number) {
    const res = await api().post("/api/v1/cotizaciones").set("Cookie", adminCookie).send({ empresaId, oportunidadId, partidas: [{ descripcion: "Servicio", cantidad: 1, precioUnitario: 1000 }] });
    expect(res.status).toBe(201);
    for (const estado of ["enviada", "aceptada"]) {
      expect((await api().patch(`/api/v1/cotizaciones/${res.body.id}/estado`).set("Cookie", adminCookie).send({ estado })).status).toBe(200);
    }
    return res.body.id as number;
  }

  async function ventas(cookie: string[], empresaId: number): Promise<Venta[]> {
    const res = await api().get(`/api/v1/documentos/expediente/${empresaId}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.empresa_id).toBe(empresaId);
    return res.body.ventas;
  }

  async function venta(cookie: string[], empresaId: number, oportunidadId: number) {
    const v = (await ventas(cookie, empresaId)).find((x) => x.oportunidad_id === oportunidadId);
    expect(v).toBeDefined();
    return { ...v!, porClave: Object.fromEntries(v!.papeles.map((p) => [p.clave, p])) as Record<string, Papel> };
  }

  const factura = (cookie: string[], id: number, llevaFactura: unknown) => api().patch(`/api/v1/oportunidades/${id}/factura`).set("Cookie", cookie).send({ llevaFactura });

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const catalogos = await api().get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
    for (const t of catalogos.body.tipos_documento) tipos[t.clave] = t.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  it("el catálogo trae los 4 obligatorios nuevos; los tipos de antes quedan opcionales y de la empresa", async () => {
    const res = await api().get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
    const porClave = Object.fromEntries(res.body.tipos_documento.map((t: { clave: string }) => [t.clave, t]));
    expect(porClave.cotizacion).toEqual(expect.objectContaining({ nombre: "Cotización", obligatorio: true, alcance: "venta", solo_con_factura: false }));
    expect(porClave.comprobante_pago).toEqual(expect.objectContaining({ obligatorio: true, alcance: "venta", solo_con_factura: false }));
    expect(porClave.comprobante_recibido).toEqual(expect.objectContaining({ nombre: "Comprobante de recibido o guía de paquetería", obligatorio: true, alcance: "venta" }));
    expect(porClave.constancia_situacion_fiscal).toEqual(expect.objectContaining({ obligatorio: true, alcance: "empresa", solo_con_factura: true }));
    for (const clave of ["contrato", "identificacion_oficial", "comprobante_domicilio", "acta_constitutiva", "cotizacion_firmada", "otro"]) {
      expect(porClave[clave]).toEqual(expect.objectContaining({ obligatorio: false, alcance: "empresa", solo_con_factura: false }));
    }
  });

  describe("papeles de una venta", () => {
    let agenteCookie: string[];
    let agenteId: number;
    let empresaId: number;

    beforeAll(async () => {
      agenteCookie = await crearAgente(app, adminCookie, `exp.venta.${Date.now()}@test.local`);
      agenteId = await usuarioId(agenteCookie);
      empresaId = await empresaDe(agenteId);
    });

    it("una venta ganada sin papeles pide cotización, pago y recibido; con factura, también la constancia", async () => {
      const op = await oportunidad(empresaId, agenteId);
      await etapa(op, "ganada");
      const v = await venta(agenteCookie, empresaId, op);
      expect(v.papeles.map((p) => p.clave)).toEqual(["cotizacion", "comprobante_pago", "comprobante_recibido"]);
      expect(v.papeles.every((p) => p.estado === "falta" && p.documento === null)).toBe(true);
      expect(v).toEqual(expect.objectContaining({ ganada: true, lleva_factura: false, aprobados: 0, total: 3, completo: false }));

      expect((await factura(agenteCookie, op, true)).status).toBe(200);
      const conFactura = await venta(agenteCookie, empresaId, op);
      expect(conFactura.papeles.map((p) => p.clave)).toEqual(["cotizacion", "comprobante_pago", "comprobante_recibido", "constancia_situacion_fiscal"]);
      expect(conFactura).toEqual(expect.objectContaining({ lleva_factura: true, total: 4 }));
    });

    it("la cotización aceptada del CRM cumple sola; sin ella, cumple un documento aprobado (también la firmada)", async () => {
      const conCrm = await oportunidad(empresaId, agenteId);
      const cotizacionId = await cotizacionAceptada(empresaId, conCrm);
      const a = await venta(agenteCookie, empresaId, conCrm);
      expect(a.ganada).toBe(true); // aceptar la cotización gana la venta
      expect(a.porClave.cotizacion).toEqual(expect.objectContaining({ estado: "aprobado", origen: "cotizacion_crm", cotizacion: expect.objectContaining({ id: cotizacionId }), documento: null }));
      expect(a.aprobados).toBe(1);

      const conArchivo = await oportunidad(empresaId, agenteId);
      const docId = await aprobado(agenteCookie, empresaId, "cotizacion", conArchivo);
      expect((await venta(agenteCookie, empresaId, conArchivo)).porClave.cotizacion).toEqual(expect.objectContaining({ estado: "aprobado", origen: "documento", documento: expect.objectContaining({ id: docId }) }));

      const conFirmada = await oportunidad(empresaId, agenteId);
      await aprobado(agenteCookie, empresaId, "cotizacion_firmada", conFirmada);
      expect((await venta(agenteCookie, empresaId, conFirmada)).porClave.cotizacion.estado).toBe("aprobado");
    });

    it("la constancia aprobada de la empresa sirve para todas sus ventas con factura", async () => {
      const a = await oportunidad(empresaId, agenteId, { llevaFactura: true });
      const b = await oportunidad(empresaId, agenteId, { llevaFactura: true });
      const constancia = await aprobado(agenteCookie, empresaId, "constancia_situacion_fiscal");
      for (const op of [a, b]) {
        expect((await venta(agenteCookie, empresaId, op)).porClave.constancia_situacion_fiscal).toEqual(expect.objectContaining({ estado: "aprobado", documento: expect.objectContaining({ id: constancia }) }));
      }
    });

    it("por revisar o rechazado no cuenta, y el pago de una venta no le sirve a otra", async () => {
      const a = await oportunidad(empresaId, agenteId);
      const b = await oportunidad(empresaId, agenteId);
      await aprobado(agenteCookie, empresaId, "comprobante_pago", a);
      await subir(agenteCookie, empresaId, "comprobante_recibido", a);
      const guiaB = await subir(agenteCookie, empresaId, "comprobante_recibido", b);
      expect((await api().patch(`/api/v1/documentos/${guiaB}/rechazar`).set("Cookie", adminCookie).send({ motivoRechazo: "ilegible", motivoRechazoDetalle: "No se lee la guía" })).status).toBe(200);

      const va = await venta(agenteCookie, empresaId, a);
      expect(va.porClave.comprobante_pago.estado).toBe("aprobado");
      expect(va.porClave.comprobante_recibido.estado).toBe("por_revisar");
      expect(va.aprobados).toBe(1);
      const vb = await venta(agenteCookie, empresaId, b);
      expect(vb.porClave.comprobante_pago.estado).toBe("falta");
      expect(vb.porClave.comprobante_recibido.estado).toBe("rechazado");
      expect(vb.completo).toBe(false);
    });

    it("con todo aprobado la venta queda completa", async () => {
      const op = await oportunidad(empresaId, agenteId);
      await cotizacionAceptada(empresaId, op);
      await aprobado(agenteCookie, empresaId, "comprobante_pago", op);
      await aprobado(agenteCookie, empresaId, "comprobante_recibido", op);
      expect(await venta(agenteCookie, empresaId, op)).toEqual(expect.objectContaining({ aprobados: 3, total: 3, completo: true }));
    });

    it("salen las abiertas y las ganadas (las ganadas primero); las perdidas no", async () => {
      const emp = await empresaDe(agenteId);
      const abierta = await oportunidad(emp, agenteId);
      const perdida = await oportunidad(emp, agenteId);
      await etapa(perdida, "perdida");
      const ganada = await oportunidad(emp, agenteId);
      await etapa(ganada, "ganada");
      const lista = await ventas(agenteCookie, emp);
      expect(lista.map((v) => v.oportunidad_id)).toEqual([ganada, abierta]);
      expect(lista[1]!.ganada).toBe(false);
    });

    it("un agente no ve el expediente de una empresa ajena", async () => {
      const otro = await crearAgente(app, adminCookie, `exp.otro.${Date.now()}@test.local`);
      expect((await api().get(`/api/v1/documentos/expediente/${empresaId}`).set("Cookie", otro)).status).toBe(404);
    });
  });

  it("expedientes incompletos cuenta ventas ganadas con faltantes, no abiertas ni completas", async () => {
    const agenteCookie = await crearAgente(app, adminCookie, `exp.conteo.${Date.now()}@test.local`);
    const agenteId = await usuarioId(agenteCookie);
    const emp1 = await empresaDe(agenteId);
    const emp2 = await empresaDe(agenteId);

    const incompleta1 = await oportunidad(emp1, agenteId);
    await etapa(incompleta1, "ganada");
    const incompleta2 = await oportunidad(emp1, agenteId, { llevaFactura: true });
    await cotizacionAceptada(emp1, incompleta2);
    await aprobado(agenteCookie, emp1, "comprobante_pago", incompleta2);
    await aprobado(agenteCookie, emp1, "comprobante_recibido", incompleta2); // le falta la constancia

    const completa = await oportunidad(emp2, agenteId);
    await cotizacionAceptada(emp2, completa);
    await aprobado(agenteCookie, emp2, "comprobante_pago", completa);
    await aprobado(agenteCookie, emp2, "comprobante_recibido", completa);
    await oportunidad(emp2, agenteId); // abierta, sin papeles: no cuenta

    const res = await api().get("/api/v1/documentos/conteos").set("Cookie", agenteCookie);
    expect(res.status).toBe(200);
    expect(res.body.expedientes_incompletos).toBe(2);
  });

  describe("subir papeles de venta", () => {
    let agenteCookie: string[];
    let empresaId: number;

    beforeAll(async () => {
      agenteCookie = await crearAgente(app, adminCookie, `exp.subir.${Date.now()}@test.local`);
      empresaId = await empresaDe(await usuarioId(agenteCookie));
    });

    it("un papel de venta sin oportunidad da 400; la constancia y los opcionales entran sin ella", async () => {
      const sinOp = await subirReq(agenteCookie, empresaId, "comprobante_pago");
      expect(sinOp.status).toBe(400);
      expect(sinOp.body.code).toBe("OPORTUNIDAD_REQUERIDA");
      expect((await subirReq(agenteCookie, empresaId, "constancia_situacion_fiscal")).status).toBe(201);
      expect((await subirReq(agenteCookie, empresaId, "contrato")).status).toBe(201);
      expect((await subirReq(agenteCookie, empresaId, null)).status).toBe(201);
    });

    it("una versión nueva no puede volver papel de venta a un documento sin oportunidad", async () => {
      const id = await subir(agenteCookie, empresaId, "otro");
      const res = await api().post(`/api/v1/documentos/${id}/version`).set("Cookie", agenteCookie)
        .field("tipoDocumentoId", String(tipos.comprobante_pago))
        .attach("archivo", Buffer.from("%PDF-1.4 v2"), { filename: "v2.pdf", contentType: "application/pdf" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("OPORTUNIDAD_REQUERIDA");
    });
  });

  describe("lleva factura", () => {
    it("lo cambia quien puede mover la venta, se audita, y sale en el detalle y la lista", async () => {
      const agenteCookie = await crearAgente(app, adminCookie, `exp.fact.${Date.now()}@test.local`);
      const agenteId = await usuarioId(agenteCookie);
      const empresaId = await empresaDe(agenteId);
      const op = await oportunidad(empresaId, agenteId);

      expect((await factura(agenteCookie, op, "si")).status).toBe(400);
      const otro = await crearAgente(app, adminCookie, `exp.fact.otro.${Date.now()}@test.local`);
      expect((await factura(otro, op, true)).status).toBe(404);

      const res = await factura(agenteCookie, op, true);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ id: op, lleva_factura: true }));
      expect((await api().get(`/api/v1/oportunidades/${op}`).set("Cookie", agenteCookie)).body.lleva_factura).toBe(true);
      const lista = await api().get("/api/v1/oportunidades").set("Cookie", agenteCookie);
      expect(lista.body.data.find((o: { id: number }) => o.id === op).lleva_factura).toBe(true);

      const [fila] = await db.select({ antes: auditoria.antes, despues: auditoria.despues }).from(auditoria)
        .where(and(eq(auditoria.entidad, "oportunidad"), eq(auditoria.entidadId, op), eq(auditoria.accion, "cambiar_lleva_factura")))
        .orderBy(desc(auditoria.id)).limit(1);
      expect(fila).toEqual({ antes: { lleva_factura: false }, despues: { lleva_factura: true } });
    });
  });
});
