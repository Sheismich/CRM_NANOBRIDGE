import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { textoDelPdf } from "./support/pdf.js";
import { CORREO_SERVICE } from "../src/integraciones/correo.types.js";
import type { CorreoFalsoDriver } from "../src/integraciones/correo-falso.driver.js";
import { cuerpoSendgrid } from "../src/integraciones/correo-sendgrid.driver.js";
import { auditoria, correosCotizacion, cotizaciones, envios, listaSupresion, mediosContacto, prospectos } from "../src/database/schema.js";

// Mandar la cotización por correo (Fabián, 3-nov-2026): el PDF adjunto, la
// firma del vendedor, el pie corto sin link de baja y el Reply-To al correo
// del vendedor. Una cotización en borrador pasa sola a "enviada".
describe("mandar la cotización por correo", () => {
  let app: INestApplication;
  let admin: string[];
  let agente: string[];
  let correo: CorreoFalsoDriver;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const partidas = [{ descripcion: "Servicio de prueba", cantidad: 2, precioUnitario: 1500 }];

  beforeAll(async () => {
    app = await createTestApp();
    correo = app.get(CORREO_SERVICE);
    admin = await ensureSeedAdmin(app);
    agente = await crearAgente(app, admin, `agente.cotcorreo.${randomUUID()}@test.local`);
  });

  beforeEach(() => {
    correo.fallar = false;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  // Empresa con dos contactos con correo, oportunidad y cotización (borrador).
  async function cotizacionNueva() {
    const sufijo = randomUUID();
    const laura = `laura.${sufijo}@cliente.test`;
    const pedro = `pedro.${sufijo}@cliente.test`;
    const empresa = await api().post("/api/v1/empresas").set("Cookie", admin).send({
      nombreLegal: `Moldes Cotización ${sufijo}`,
      contactos: [{ nombre: "Laura Gómez", correo: laura }, { nombre: "Pedro Ruiz", correo: pedro }]
    });
    expect(empresa.status).toBe(201);
    const empresaId = empresa.body.id as number;
    const detalle = await api().get(`/api/v1/empresas/${empresaId}`).set("Cookie", admin);
    const contactoDe = (nombre: string) => (detalle.body.contactos as { id: number; nombre: string }[]).find((c) => c.nombre === nombre)!.id;
    const op = await api().post("/api/v1/oportunidades").set("Cookie", admin).send({ empresaId, titulo: `Moldes nuevos ${sufijo}` });
    expect(op.status).toBe(201);
    const cot = await api().post("/api/v1/cotizaciones").set("Cookie", admin).send({ empresaId, oportunidadId: op.body.id, contactoId: contactoDe("Laura Gómez"), partidas });
    expect(cot.status).toBe(201);
    return { id: cot.body.id as number, empresaId, oportunidadId: op.body.id as number, laura, pedro, lauraId: contactoDe("Laura Gómez"), pedroId: contactoDe("Pedro Ruiz") };
  }

  const yo = async (cookie: string[]) => (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body as { id: number; correo: string };
  const contexto = (cookie: string[], id: number) => api().get(`/api/v1/cotizaciones/${id}/correo`).set("Cookie", cookie);
  const mandar = (cookie: string[], id: number, body: Record<string, unknown>) => api().post(`/api/v1/cotizaciones/${id}/correo`).set("Cookie", cookie).send(body);

  it("sin sesión, 401", async () => {
    expect((await api().get("/api/v1/cotizaciones/1/correo")).status).toBe(401);
    expect((await api().post("/api/v1/cotizaciones/1/correo").send({})).status).toBe(401);
  });

  it("el contexto trae los contactos con correo, el de la cotización primero elegido, y un asunto y texto listos", async () => {
    const c = await cotizacionNueva();
    const res = await contexto(admin, c.id);
    expect(res.status).toBe(200);
    expect(res.body.motivo).toBeNull();
    expect(res.body.contacto_id).toBe(c.lauraId);
    expect(res.body.contactos).toEqual(expect.arrayContaining([
      { id: c.lauraId, nombre: "Laura Gómez", correo: c.laura, motivo: null },
      { id: c.pedroId, nombre: "Pedro Ruiz", correo: c.pedro, motivo: null }
    ]));
    expect(res.body.asunto).toBe(`Cotización #${c.id} · NANOBRIDGE`);
    expect(res.body.texto).toContain("Laura Gómez");
    expect(res.body.texto).toContain(`#${c.id}`);
    expect(res.body.archivo).toBe(`cotizacion-${c.id}-v1.pdf`);
  });

  it("manda el correo con el PDF adjunto, la firma, el pie y sin link de baja; Reply-To al vendedor; la cotización pasa a enviada", async () => {
    const c = await cotizacionNueva();
    const res = await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Su cotización", texto: "Hola Laura, le comparto la cotización." });
    expect(res.status).toBe(201);
    expect(res.body).toEqual(expect.objectContaining({ estado: "enviado", cotizacion_estado: "enviada" }));

    const enviado = correo.enviados.find((e) => e.para === c.laura)!;
    expect(enviado).toBeDefined();
    expect(enviado.asunto).toBe("Su cotización");
    expect(enviado.nombrePara).toBe("Laura Gómez");
    expect(enviado.nombreRemitente).toBe("Admin Semilla · NANOBRIDGE");
    expect(enviado.replyTo).toBe((await yo(admin)).correo);
    expect(enviado.html).toContain("Hola Laura, le comparto la cotización.");
    expect(enviado.html).toContain("Admin Semilla");
    expect(enviado.html).not.toContain("Darte de baja");
    expect(enviado.texto).not.toContain("Darte de baja");
    expect(enviado.adjuntos).toHaveLength(1);
    const [adjunto] = enviado.adjuntos!;
    expect(adjunto.nombre).toBe(`cotizacion-${c.id}-v1.pdf`);
    expect(adjunto.tipo).toBe("application/pdf");
    const pdf = Buffer.from(adjunto.contenidoBase64, "base64");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await textoDelPdf(pdf)).join(" ")).toContain("Servicio de prueba");

    // SendGrid recibe el adjunto y sin link de baja.
    const cuerpo = cuerpoSendgrid(enviado);
    expect(cuerpo.attachments).toEqual([{ filename: `cotizacion-${c.id}-v1.pdf`, type: "application/pdf", content: adjunto.contenidoBase64, disposition: "attachment" }]);
    expect(cuerpo.tracking_settings.subscription_tracking).toEqual({ enable: false });

    const [cot] = await db.select({ estado: cotizaciones.estado, fechaEnvio: cotizaciones.fechaEnvio }).from(cotizaciones).where(eq(cotizaciones.id, c.id));
    expect(cot!.estado).toBe("enviada");
    expect(cot!.fechaEnvio).not.toBeNull();
    const [fila] = await db.select().from(correosCotizacion).where(eq(correosCotizacion.cotizacionId, c.id));
    expect(fila).toEqual(expect.objectContaining({ estado: "enviado", para: c.laura, contactoId: c.lauraId, empresaId: c.empresaId, asunto: "Su cotización", proveedorId: expect.stringMatching(/^falso-/) }));
    const [audit] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "cotizacion"), eq(auditoria.entidadId, c.id), eq(auditoria.accion, "mandar_por_correo")));
    expect(audit).toBeDefined();
  });

  it("no es un envío de prospección: no crea envíos ni prospectos", async () => {
    const c = await cotizacionNueva();
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Le comparto la cotización." })).status).toBe(201);
    const [p] = await db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.contactoId, c.lauraId));
    expect(p).toBeUndefined();
    const enviosDeEmpresa = await db.select({ id: envios.id }).from(envios).innerJoin(prospectos, eq(prospectos.id, envios.prospectoId)).where(eq(prospectos.contactoId, c.lauraId));
    expect(enviosDeEmpresa).toHaveLength(0);
  });

  it("una ya enviada se puede volver a mandar a otro contacto y sigue enviada", async () => {
    const c = await cotizacionNueva();
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Le comparto la cotización." })).status).toBe(201);
    const res = await mandar(admin, c.id, { contactoId: c.pedroId, asunto: "Cotización", texto: "Le comparto la cotización." });
    expect(res.status).toBe(201);
    expect(res.body.cotizacion_estado).toBe("enviada");
    expect(correo.enviados.some((e) => e.para === c.pedro)).toBe(true);
  });

  it("aceptada, rechazada, vencida u obsoleta no se manda (409 con motivo en el contexto)", async () => {
    const c = await cotizacionNueva();
    expect((await api().patch(`/api/v1/cotizaciones/${c.id}/estado`).set("Cookie", admin).send({ estado: "enviada" })).status).toBe(200);
    expect((await api().patch(`/api/v1/cotizaciones/${c.id}/estado`).set("Cookie", admin).send({ estado: "rechazada", motivoRechazo: "precio" })).status).toBe(200);
    const ctx = await contexto(admin, c.id);
    expect(ctx.status).toBe(200);
    expect(ctx.body.motivo).toMatch(/rechazada/i);
    const res = await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Hola." });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COTIZACION_NO_SE_MANDA");
  });

  it("con el correo del contacto en la lista de supresión o la persona en baja, no se manda", async () => {
    const c = await cotizacionNueva();
    await db.insert(listaSupresion).values({ tipo: "correo", valorNormalizado: c.pedro, motivo: "prueba" });
    const ctx = await contexto(admin, c.id);
    expect(ctx.body.contactos.find((x: { id: number }) => x.id === c.pedroId).motivo).toMatch(/no contactar/i);
    const res = await mandar(admin, c.id, { contactoId: c.pedroId, asunto: "Cotización", texto: "Hola." });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CONTACTO_NO_CONTACTAR");
    expect(correo.enviados.some((e) => e.para === c.pedro)).toBe(false);

    await db.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(eq(mediosContacto.contactoId, c.lauraId));
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Hola." })).body.code).toBe("CONTACTO_NO_CONTACTAR");
  });

  it("un contacto de otra empresa no se acepta (404)", async () => {
    const c = await cotizacionNueva();
    const otra = await cotizacionNueva();
    expect((await mandar(admin, c.id, { contactoId: otra.lauraId, asunto: "Cotización", texto: "Hola." })).status).toBe(404);
  });

  it("un agente que no es responsable de la oportunidad no la ve (404)", async () => {
    const c = await cotizacionNueva();
    expect((await contexto(agente, c.id)).status).toBe(404);
    expect((await mandar(agente, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Hola." })).status).toBe(404);
  });

  it("texto o asunto vacío: 400", async () => {
    const c = await cotizacionNueva();
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "   " })).status).toBe(400);
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "", texto: "Hola." })).status).toBe(400);
  });

  it("si SendGrid falla: 502, la fila queda 'fallido' y la cotización sigue en borrador", async () => {
    const c = await cotizacionNueva();
    correo.fallar = true;
    const res = await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Hola." });
    expect(res.status).toBe(502);
    const [fila] = await db.select({ estado: correosCotizacion.estado }).from(correosCotizacion).where(eq(correosCotizacion.cotizacionId, c.id));
    expect(fila!.estado).toBe("fallido");
    const [cot] = await db.select({ estado: cotizaciones.estado }).from(cotizaciones).where(eq(cotizaciones.id, c.id));
    expect(cot!.estado).toBe("borrador");
    correo.fallar = false;
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Hola." })).status).toBe(201);
  });

  it("mientras hay uno 'enviando' de la misma cotización, otro da 409 (sin doble correo)", async () => {
    const c = await cotizacionNueva();
    await db.insert(correosCotizacion).values({ cotizacionId: c.id, empresaId: c.empresaId, contactoId: c.lauraId, usuarioId: (await yo(admin)).id, para: c.laura, asunto: "x", texto: "x", estado: "enviando" });
    const res = await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Cotización", texto: "Hola." });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("COTIZACION_ENVIANDO");
  });

  it("el Historial de la ficha muestra 'cotizacion_enviada' (solo las que salieron)", async () => {
    const c = await cotizacionNueva();
    correo.fallar = true;
    await mandar(admin, c.id, { contactoId: c.pedroId, asunto: "Cotización", texto: "Hola." });
    correo.fallar = false;
    expect((await mandar(admin, c.id, { contactoId: c.lauraId, asunto: "Su cotización", texto: "Hola." })).status).toBe(201);
    const res = await api().get("/api/v1/actividades").query({ empresaId: c.empresaId, limit: 100 }).set("Cookie", admin);
    expect(res.status).toBe(200);
    const eventos = (res.body.data as { tipo: string; detalle: Record<string, unknown> }[]).filter((e) => e.tipo === "cotizacion_enviada");
    expect(eventos).toHaveLength(1);
    expect(eventos[0]!.detalle).toEqual(expect.objectContaining({ cotizacion_id: c.id, version: 1, contacto_nombre: "Laura Gómez", para: c.laura, asunto: "Su cotización", usuario_nombre: "Admin Semilla" }));
    // Filtrando por el otro contacto no sale.
    const dePedro = await api().get("/api/v1/actividades").query({ empresaId: c.empresaId, contactoId: c.pedroId, limit: 100 }).set("Cookie", admin);
    expect((dePedro.body.data as { tipo: string }[]).some((e) => e.tipo === "cotizacion_enviada")).toBe(false);
  });
});
