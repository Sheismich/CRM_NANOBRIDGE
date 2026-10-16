import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin, loginAs } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, documentos, empresas, tareas, usuarios } from "../src/database/schema.js";
import { CLAVES_MOTIVO_RECHAZO_DOCUMENTO } from "../src/shared/motivos-rechazo-documento.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Documentos del rediseño (bloque 3, 12-oct-2026): aprobar / rechazar con
// motivo (solo admin y supervisor), la tarea "Corregir documento" para quien
// lo subió, los papeles obligatorios del catálogo, el expediente de cada
// cliente y los contadores de la pantalla.
describe("documentos: revisión, expediente y contadores", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let supervisorCookie: string[];
  const tipos: Record<string, number> = {};
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  async function usuarioId(cookie: string[]) {
    return (await api().get("/api/v1/auth/me").set("Cookie", cookie)).body.id as number;
  }

  // Empresa del agente (propietario_id): así el agente puede subirle papeles.
  async function empresaDe(propietarioId: number | null, nombre = `Docs ${marca} ${randomUUID().slice(0, 4)}`) {
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: nombre, contactos: [{ nombre: "Contacto", correo: `doc.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    await db.update(empresas).set({ propietarioId }).where(eq(empresas.id, res.body.id));
    return res.body.id as number;
  }

  async function subir(cookie: string[], empresaId: number, tipo: string | null, nombre = `${randomUUID().slice(0, 6)}.pdf`) {
    let req = api().post("/api/v1/documentos").set("Cookie", cookie).field("empresaId", String(empresaId));
    if (tipo) req = req.field("tipoDocumentoId", String(tipos[tipo]));
    const res = await req.attach("archivo", Buffer.from("%PDF-1.4 prueba"), { filename: nombre, contentType: "application/pdf" });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function aprobar(cookie: string[], id: number) {
    return api().patch(`/api/v1/documentos/${id}/aprobar`).set("Cookie", cookie).send({});
  }

  function rechazar(cookie: string[], id: number, body: Record<string, unknown> = { motivoRechazo: "ilegible", motivoRechazoDetalle: "El sello de la notaría no se lee" }) {
    return api().patch(`/api/v1/documentos/${id}/rechazar`).set("Cookie", cookie).send(body);
  }

  async function tareasDe(documentoId: number) {
    return db.select().from(tareas).where(eq(tareas.documentoId, documentoId));
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const correoSup = `sup.docs.${Date.now()}@test.local`;
    expect((await api().post("/api/v1/usuarios").set("Cookie", adminCookie).send({ nombre: "Supervisora", correo: correoSup, password: "password_sup_1", rol: "supervisor" })).status).toBe(201);
    supervisorCookie = await loginAs(app, correoSup, "password_sup_1");
    const catalogos = await api().get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
    for (const t of catalogos.body.tipos_documento) tipos[t.clave] = t.id;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("aprobar y rechazar", () => {
    let agenteCookie: string[];
    let agenteId: number;
    let empresaId: number;

    beforeAll(async () => {
      agenteCookie = await crearAgente(app, adminCookie, `docs.rev.${Date.now()}@test.local`);
      agenteId = await usuarioId(agenteCookie);
      empresaId = await empresaDe(agenteId);
    });

    it("solo administrador y supervisor aprueban o rechazan", async () => {
      const id = await subir(agenteCookie, empresaId, "acta_constitutiva");
      expect((await aprobar(agenteCookie, id)).status).toBe(403);
      expect((await rechazar(agenteCookie, id)).status).toBe(403);
      const res = await aprobar(supervisorCookie, id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ revision: "aprobado", revisado_por: expect.any(Number), revisado_en: expect.anything() }));
    });

    it("rechazar pide motivo y explicación", async () => {
      const id = await subir(agenteCookie, empresaId, "contrato");
      expect((await rechazar(adminCookie, id, {})).status).toBe(400);
      expect((await rechazar(adminCookie, id, { motivoRechazo: "vencido" })).status).toBe(400);
      expect((await rechazar(adminCookie, id, { motivoRechazo: "vencido", motivoRechazoDetalle: "x" })).status).toBe(400);
      expect((await rechazar(adminCookie, id, { motivoRechazo: "inventado", motivoRechazoDetalle: "Algo" })).status).toBe(400);
    });

    it("al rechazar guarda el motivo, lo audita y crea UNA tarea para quien lo subió", async () => {
      const id = await subir(agenteCookie, empresaId, "acta_constitutiva", `Acta ${marca}.pdf`);
      const res = await rechazar(adminCookie, id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ revision: "rechazado", motivo_rechazo: "ilegible", motivo_rechazo_detalle: "El sello de la notaría no se lee" }));

      const [fila] = await db.select({ despues: auditoria.despues }).from(auditoria).where(and(eq(auditoria.entidad, "documento"), eq(auditoria.entidadId, id), eq(auditoria.accion, "rechazar")));
      expect(fila!.despues).toEqual(expect.objectContaining({ revision: "rechazado", motivo_rechazo: "ilegible" }));

      const [tarea] = await tareasDe(id);
      expect(tarea).toEqual(expect.objectContaining({ tipo: "revision_documento", estado: "pendiente", responsableId: agenteId, empresaId, titulo: `Corregir documento: Acta ${marca}.pdf` }));
      expect(tarea!.descripcion).toContain("Ilegible o borroso");
      expect(tarea!.descripcion).toContain("El sello de la notaría no se lee");
      expect(tarea!.fechaLimite).not.toBeNull();

      // Rechazarlo otra vez no duplica la tarea.
      expect((await rechazar(adminCookie, id, { motivoRechazo: "incompleto", motivoRechazoDetalle: "Faltan páginas" })).status).toBe(200);
      expect(await tareasDe(id)).toHaveLength(1);
    });

    it("la versión nueva vuelve a 'por revisar' y cierra la tarea sola", async () => {
      const id = await subir(agenteCookie, empresaId, "comprobante_domicilio");
      await rechazar(adminCookie, id);
      const v2 = await api().post(`/api/v1/documentos/${id}/version`).set("Cookie", agenteCookie).attach("archivo", Buffer.from("%PDF-1.4 v2"), { filename: "v2.pdf", contentType: "application/pdf" });
      expect(v2.status).toBe(201);
      const nueva = await api().get(`/api/v1/documentos/${v2.body.id}`).set("Cookie", agenteCookie);
      expect(nueva.body).toEqual(expect.objectContaining({ revision: "por_revisar", motivo_rechazo: null }));
      const [tarea] = await tareasDe(id);
      expect(tarea).toEqual(expect.objectContaining({ estado: "cerrada", resultado: "Se subió la versión 2" }));
      expect(tarea!.cerradaEn).not.toBeNull();
    });

    it("archivar, borrar o aprobar después de rechazar cancela la tarea", async () => {
      const archivado = await subir(agenteCookie, empresaId, "contrato");
      await rechazar(adminCookie, archivado);
      expect((await api().patch(`/api/v1/documentos/${archivado}/estado`).set("Cookie", adminCookie).send({ estado: "archivado" })).status).toBe(200);
      expect((await tareasDe(archivado))[0]!.estado).toBe("cancelada");

      const borrado = await subir(agenteCookie, empresaId, "contrato");
      await rechazar(adminCookie, borrado);
      expect((await api().delete(`/api/v1/documentos/${borrado}`).set("Cookie", adminCookie)).status).toBe(204);
      expect((await tareasDe(borrado))[0]!.estado).toBe("cancelada");

      const cambio = await subir(agenteCookie, empresaId, "contrato");
      await rechazar(adminCookie, cambio);
      expect((await aprobar(adminCookie, cambio)).body.revision).toBe("aprobado");
      expect((await tareasDe(cambio))[0]!.estado).toBe("cancelada");
    });

    it("si quien lo subió ya no está activo, la tarea va al dueño de la empresa; sin dueño, sin asignar", async () => {
      const otroCookie = await crearAgente(app, adminCookie, `docs.baja.${Date.now()}@test.local`);
      const otroId = await usuarioId(otroCookie);
      const emp = await empresaDe(otroId);
      const id1 = await subir(otroCookie, emp, "contrato");
      const id2 = await subir(otroCookie, emp, "acta_constitutiva");
      await db.update(usuarios).set({ activo: false }).where(eq(usuarios.id, otroId));

      await db.update(empresas).set({ propietarioId: agenteId }).where(eq(empresas.id, emp));
      await rechazar(adminCookie, id1);
      expect((await tareasDe(id1))[0]!.responsableId).toBe(agenteId);

      await db.update(empresas).set({ propietarioId: null }).where(eq(empresas.id, emp));
      await rechazar(adminCookie, id2);
      expect((await tareasDe(id2))[0]!.responsableId).toBeNull();
    });

    // Día del cambio (15-oct-2026): el botón viejo ya no es de agentes.
    it("el botón viejo 'Revisado' ya no lo usa un agente (403); un administrador sí y deja el documento aprobado", async () => {
      const id = await subir(agenteCookie, empresaId, "identificacion_oficial");
      expect((await api().patch(`/api/v1/documentos/${id}/revisar`).set("Cookie", agenteCookie).send({})).status).toBe(403);
      const res = await api().patch(`/api/v1/documentos/${id}/revisar`).set("Cookie", adminCookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.revision).toBe("aprobado");
    });

    it("solo se revisa la versión vigente", async () => {
      const id = await subir(agenteCookie, empresaId, "contrato");
      await api().patch(`/api/v1/documentos/${id}/estado`).set("Cookie", adminCookie).send({ estado: "archivado" });
      expect((await aprobar(adminCookie, id)).status).toBe(409);
      expect((await rechazar(adminCookie, id)).status).toBe(409);
    });
  });

  // Los obligatorios son los del 16-oct-2026 (expediente por venta, ver
  // test/490-expediente-por-venta.spec.ts); el 12-oct no había ninguno.
  it("los motivos salen del catálogo y coinciden con el ENUM de la base; los obligatorios son los 4 de la venta", async () => {
    const res = await api().get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
    expect(res.body.motivos_rechazo.map((m: { clave: string }) => m.clave)).toEqual([...CLAVES_MOTIVO_RECHAZO_DOCUMENTO]);
    expect(res.body.motivos_rechazo[0]).toEqual({ clave: "ilegible", nombre: "Ilegible o borroso" });
    expect(res.body.tipos_documento.filter((t: { obligatorio: boolean }) => t.obligatorio).map((t: { clave: string }) => t.clave).sort())
      .toEqual(["comprobante_pago", "comprobante_recibido", "constancia_situacion_fiscal", "cotizacion"]);
    const [filas] = await db.execute(sql`SELECT COLUMN_TYPE AS tipo FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'documentos' AND COLUMN_NAME = 'motivo_rechazo'`);
    const tipo = (filas as unknown as { tipo: string }[])[0]!.tipo;
    expect([...tipo.matchAll(/'([^']*)'/g)].map((m) => m[1])).toEqual([...CLAVES_MOTIVO_RECHAZO_DOCUMENTO]);
  });

  describe("lista y contadores de un agente", () => {
    let agenteCookie: string[];
    let empExpediente: number;
    let empSoloDoc: number;
    let empGanada: number;
    let empCompleta: number;
    const ids: Record<string, number> = {};
    const CINCO_PAPELES = ["acta_constitutiva", "comprobante_domicilio", "identificacion_oficial", "contrato", "cotizacion_firmada"];

    beforeAll(async () => {
      agenteCookie = await crearAgente(app, adminCookie, `docs.exp.${Date.now()}@test.local`);
      const agenteId = await usuarioId(agenteCookie);
      empExpediente = await empresaDe(agenteId, `Moldes ${marca} SA`);
      empSoloDoc = await empresaDe(agenteId);
      empGanada = await empresaDe(agenteId);
      empCompleta = await empresaDe(agenteId);
      await empresaDe(agenteId); // prospecto: sin papeles ni oportunidad ganada, no cuenta

      // Expediente: acta aprobada + otra acta rechazada (cuenta la aprobada),
      // comprobante por revisar, identificación rechazada, faltan contrato y
      // cotización firmada.
      ids.acta = await subir(agenteCookie, empExpediente, "acta_constitutiva", `Acta constitutiva ${marca}.pdf`);
      await aprobar(adminCookie, ids.acta);
      ids.actaDuplicada = await subir(agenteCookie, empExpediente, "acta_constitutiva");
      await rechazar(adminCookie, ids.actaDuplicada);
      ids.comprobante = await subir(agenteCookie, empExpediente, "comprobante_domicilio");
      ids.identificacion = await subir(agenteCookie, empExpediente, "identificacion_oficial");
      await rechazar(adminCookie, ids.identificacion, { motivoRechazo: "vencido", motivoRechazoDetalle: "INE vencida en 2024" });

      // Solo un documento suelto (sin tipo): cuenta como cliente incompleto.
      ids.suelto = await subir(agenteCookie, empSoloDoc, null);

      // Ganada sin papeles: incompleta.
      const op = await api().post("/api/v1/oportunidades").set("Cookie", adminCookie).send({ empresaId: empGanada, titulo: `Ganada ${marca}`, responsableId: agenteId });
      expect((await api().patch(`/api/v1/oportunidades/${op.body.id}/etapa`).set("Cookie", adminCookie).send({ etapaClave: "ganada" })).status).toBe(200);

      // Completa: los 5 aprobados.
      for (const clave of CINCO_PAPELES) {
        await aprobar(adminCookie, await subir(agenteCookie, empCompleta, clave));
      }
    });

    it("un agente no ve el expediente de una empresa que no es suya", async () => {
      const otro = await crearAgente(app, adminCookie, `docs.otro.${Date.now()}@test.local`);
      expect((await api().get(`/api/v1/documentos/expediente/${empExpediente}`).set("Cookie", otro)).status).toBe(404);
    });

    it("los contadores cuentan por revisar, aprobados, rechazados y expedientes incompletos", async () => {
      const res = await api().get("/api/v1/documentos/conteos").set("Cookie", agenteCookie);
      expect(res.status).toBe(200);
      // Por revisar: comprobante + suelto. Aprobados: acta + 5 de la completa.
      // Rechazados: acta duplicada + identificación. Incompletos: solo la
      // venta ganada sin papeles (desde el 16-oct se cuentan ventas, y los
      // papeles de empresa de antes ya no son obligatorios).
      expect(res.body).toEqual({ por_revisar: 2, aprobados: 6, rechazados: 2, expedientes_incompletos: 1 });
    });

    it("la lista filtra por revisión, tipo y texto, y dice el tipo y quién revisó", async () => {
      const rechazados = await api().get("/api/v1/documentos").set("Cookie", agenteCookie).query({ revision: "rechazado" });
      expect(rechazados.body.data.map((d: { id: number }) => d.id).sort()).toEqual([ids.actaDuplicada, ids.identificacion].sort());
      expect(rechazados.body.data[0]).toEqual(expect.objectContaining({ revision: "rechazado", tipo_nombre: expect.any(String), revisado_por_nombre: expect.any(String) }));

      const actas = await api().get("/api/v1/documentos").set("Cookie", agenteCookie).query({ tipoDocumentoId: tipos.acta_constitutiva, empresaId: empExpediente });
      expect(actas.body.data).toHaveLength(2);

      const porArchivo = await api().get("/api/v1/documentos").set("Cookie", agenteCookie).query({ q: `Acta constitutiva ${marca}` });
      expect(porArchivo.body.data.map((d: { id: number }) => d.id)).toEqual([ids.acta]);
      const porEmpresa = await api().get("/api/v1/documentos").set("Cookie", agenteCookie).query({ q: `Moldes ${marca}` });
      expect(porEmpresa.body.data).toHaveLength(4);
    });
  });

  it("el aviso diario solo cuenta lo que sigue por revisar", async () => {
    const empresaId = await empresaDe(null);
    const porRevisar = await subir(adminCookie, empresaId, "contrato");
    const rechazado = await subir(adminCookie, empresaId, "contrato");
    await rechazar(adminCookie, rechazado);
    const hace8Dias = new Date(Date.now() - 8 * 86_400_000);
    await db.update(documentos).set({ creadoEn: hace8Dias }).where(sql`${documentos.id} IN (${porRevisar}, ${rechazado})`);
    expect((await api().post("/api/v1/automatizacion/jobs/documentos-pendientes").set("X-API-Key", API_KEY)).status).toBe(200);
    const filas = await db.select({ id: documentos.id, alertadoEn: documentos.alertadoEn }).from(documentos).where(sql`${documentos.id} IN (${porRevisar}, ${rechazado})`);
    expect(filas.find((f) => f.id === porRevisar)!.alertadoEn).not.toBeNull();
    expect(filas.find((f) => f.id === rechazado)!.alertadoEn).toBeNull();
  });

  // Al final: cambia el catálogo (compartido) y lo deja como estaba.
  it("solo el administrador cambia qué papel es obligatorio, y queda auditado", async () => {
    const ruta = `/api/v1/documentos/catalogos/tipos/${tipos.otro}`;
    expect((await api().patch(ruta).set("Cookie", supervisorCookie).send({ obligatorio: true })).status).toBe(403);
    expect((await api().patch(ruta).set("Cookie", adminCookie).send({ obligatorio: "si" })).status).toBe(400);
    const res = await api().patch(ruta).set("Cookie", adminCookie).send({ obligatorio: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ id: tipos.otro, clave: "otro", obligatorio: true }));
    const [fila] = await db.select({ antes: auditoria.antes, despues: auditoria.despues }).from(auditoria)
      .where(and(eq(auditoria.entidad, "catalogo_tipo_documento"), eq(auditoria.entidadId, tipos.otro!), eq(auditoria.accion, "cambiar_obligatorio")))
      .orderBy(sql`${auditoria.id} DESC`).limit(1);
    expect(fila).toEqual({ antes: { obligatorio: false }, despues: { obligatorio: true } });
    expect((await api().patch(ruta).set("Cookie", adminCookie).send({ obligatorio: false })).status).toBe(200);
  });
});
