import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, documentos, empresas } from "../src/database/schema.js";
import { env } from "../src/config/env.js";

// Documentos del rediseño (bloque 3, 12-oct-2026): vista previa dentro de la
// página (?modo=ver) y "Descargar lote" (zip en streaming).
describe("documentos: vista previa y descargar lote", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let agenteCookie: string[];
  let adminId: number;
  const marca = randomUUID().slice(0, 8);
  const db = testDb();
  const api = () => request(app.getHttpServer());

  // Junta la respuesta binaria completa (el zip) en un Buffer.
  // (supertest le pasa la respuesta HTTP cruda, que es un stream.)
  function binario(res: unknown, callback: (error: Error | null, body: Buffer) => void) {
    const stream = res as NodeJS.ReadableStream;
    const partes: Buffer[] = [];
    stream.on("data", (parte: Buffer) => partes.push(parte));
    stream.on("end", () => callback(null, Buffer.concat(partes)));
  }

  // Cuántas entradas trae un zip: "End of central directory", los últimos 22
  // bytes (sin comentario), total de entradas en el byte 10.
  function entradasDelZip(zip: Buffer) {
    const eocd = zip.subarray(zip.length - 22);
    expect(eocd.readUInt32LE(0)).toBe(0x06054b50);
    return eocd.readUInt16LE(10);
  }

  async function empresa(nombre: string) {
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: nombre, contactos: [{ nombre: "Contacto", correo: `lote.${randomUUID()}@test.local` }] });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  async function subir(empresaId: number, nombre: string, contenido: Buffer, contentType: string) {
    const res = await api().post("/api/v1/documentos").set("Cookie", adminCookie).field("empresaId", String(empresaId)).attach("archivo", contenido, { filename: nombre, contentType });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  // Documento escrito directo al storage local de pruebas (para no mandar
  // cientos de MB por multipart).
  const escritosDirecto: string[] = [];
  async function documentoDirecto(empresaId: number, nombre: string, bytes: number) {
    const key = `documentos/${empresaId}/${randomUUID()}.pdf`;
    const ruta = resolve(env.STORAGE_LOCAL_DIR, key);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, Buffer.alloc(bytes, 0x41));
    escritosDirecto.push(ruta);
    const [r] = await db.insert(documentos).values({ empresaId, version: 1, nombreOriginal: nombre, mimeType: "application/pdf", tamanoBytes: bytes, storageDriver: "local", storageKey: key, subidoPor: adminId });
    return r.insertId;
  }

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    adminId = (await api().get("/api/v1/auth/me").set("Cookie", adminCookie)).body.id;
    agenteCookie = await crearAgente(app, adminCookie, `docs.lote.${Date.now()}@test.local`);
  });

  afterAll(async () => {
    // Los 120 MB del zip grande no se quedan en storage-test.
    await Promise.all(escritosDirecto.map((ruta) => rm(ruta, { force: true })));
    await app.close();
    await closeTestDb();
  });

  describe("vista previa", () => {
    let pdf: number;
    let docx: number;

    beforeAll(async () => {
      const emp = await empresa(`Vista ${marca}`);
      pdf = await subir(emp, "Acta constitutiva.pdf", Buffer.from("%PDF-1.4 vista previa"), "application/pdf");
      docx = await subir(emp, "Contrato.docx", Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("word/document.xml")]), "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    });

    it("modo=ver abre el PDF dentro de la página, con nosniff y CSP sandbox, y se audita como 'ver'", async () => {
      const res = await api().get(`/api/v1/documentos/${pdf}/descarga`).set("Cookie", adminCookie).query({ modo: "ver" });
      expect(res.status).toBe(200);
      expect(res.headers["content-disposition"]).toMatch(/^inline; filename="Acta constitutiva.pdf"/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.headers["content-security-policy"]).toBe("sandbox");
      expect(res.headers["cache-control"]).toBe("no-store");
      const acciones = await db.select({ accion: auditoria.accion }).from(auditoria).where(and(eq(auditoria.entidad, "documento"), eq(auditoria.entidadId, pdf)));
      expect(acciones.map((a) => a.accion)).toContain("ver");
      expect(acciones.map((a) => a.accion)).not.toContain("descargar");
    });

    it("sin modo sigue siendo descarga adjunta, auditada como 'descargar' y sin CSP", async () => {
      const res = await api().get(`/api/v1/documentos/${pdf}/descarga`).set("Cookie", adminCookie);
      expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
      expect(res.headers["content-security-policy"]).toBeUndefined();
      const acciones = await db.select({ accion: auditoria.accion }).from(auditoria).where(and(eq(auditoria.entidad, "documento"), eq(auditoria.entidadId, pdf)));
      expect(acciones.map((a) => a.accion)).toContain("descargar");
    });

    it("Word y Excel no tienen vista previa (415) y no se auditan", async () => {
      const res = await api().get(`/api/v1/documentos/${docx}/descarga`).set("Cookie", adminCookie).query({ modo: "ver" });
      expect(res.status).toBe(415);
      expect(res.body.code).toBe("VISTA_PREVIA_NO_DISPONIBLE");
      expect(await db.select().from(auditoria).where(and(eq(auditoria.entidadId, docx), eq(auditoria.accion, "ver")))).toHaveLength(0);
      expect((await api().get(`/api/v1/documentos/${docx}/descarga`).set("Cookie", adminCookie).query({ modo: "otro" })).status).toBe(400);
    });
  });

  describe("descargar lote", () => {
    let empLote: number;

    beforeAll(async () => {
      empLote = await empresa(`Lote ${marca} SA`);
      await subir(empLote, "Acta.pdf", Buffer.from("%PDF-1.4 acta"), "application/pdf");
      await subir(empLote, "Acta.pdf", Buffer.from("%PDF-1.4 otra acta"), "application/pdf"); // mismo nombre
      await subir(empLote, "INE.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]), "image/png");
      const archivado = await subir(empLote, "Viejo.pdf", Buffer.from("%PDF-1.4 viejo"), "application/pdf");
      await api().patch(`/api/v1/documentos/${archivado}/estado`).set("Cookie", adminCookie).send({ estado: "archivado" });
    });

    it("un agente no puede bajar lotes", async () => {
      expect((await api().get("/api/v1/documentos/lote").set("Cookie", agenteCookie).query({ empresaId: empLote })).status).toBe(403);
    });

    it("manda un zip en streaming con lo vigente filtrado, sin repetir nombres, y deja UNA auditoría", async () => {
      const res = await api().get("/api/v1/documentos/lote").set("Cookie", adminCookie).query({ empresaId: empLote }).buffer(true).parse(binario);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/zip");
      expect(res.headers["content-length"]).toBeUndefined();
      expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="documentos-\d{4}-\d{2}-\d{2}\.zip"/);
      const zip = res.body as Buffer;
      expect(entradasDelZip(zip)).toBe(3); // sin el archivado
      const texto = zip.toString("latin1");
      expect(texto).toContain(`Lote ${marca} SA/Acta.pdf`);
      expect(texto).toContain(`Lote ${marca} SA/Acta (2).pdf`);
      expect(texto).toContain(`Lote ${marca} SA/INE.png`);

      const filas = await db.select({ despues: auditoria.despues }).from(auditoria).where(and(eq(auditoria.accion, "descargar_lote"), eq(auditoria.usuarioId, adminId)));
      const mia = filas.map((f) => f.despues as { documento_ids: number[]; cantidad: number }).filter((d) => d.cantidad === 3);
      expect(mia.length).toBeGreaterThanOrEqual(1);
    });

    it("sin documentos con esos filtros es 404", async () => {
      expect((await api().get("/api/v1/documentos/lote").set("Cookie", adminCookie).query({ empresaId: empLote, q: "no-existe-nada" })).status).toBe(404);
    });

    it("más de 100 documentos es 413 y pide filtrar", async () => {
      const emp = await empresa(`Lote grande ${marca}`);
      await db.insert(documentos).values(Array.from({ length: 101 }, (_, i) => ({ empresaId: emp, version: 1, nombreOriginal: `doc-${i}.pdf`, mimeType: "application/pdf", tamanoBytes: 10, storageDriver: "local", storageKey: `documentos/${emp}/no-existe-${i}.pdf`, subidoPor: adminId })));
      const res = await api().get("/api/v1/documentos/lote").set("Cookie", adminCookie).query({ empresaId: emp });
      expect(res.status).toBe(413);
      expect(res.body.code).toBe("LOTE_DEMASIADO_GRANDE");
    });

    it("más de 200 MB es 413", async () => {
      const emp = await empresa(`Lote pesado ${marca}`);
      await db.insert(documentos).values({ empresaId: emp, version: 1, nombreOriginal: "enorme.pdf", mimeType: "application/pdf", tamanoBytes: 201 * 1024 * 1024, storageDriver: "local", storageKey: `documentos/${emp}/no-existe.pdf`, subidoPor: adminId });
      expect((await api().get("/api/v1/documentos/lote").set("Cookie", adminCookie).query({ empresaId: emp })).status).toBe(413);
    });

    // Fabián (12-oct-2026): probarlo con un zip grande. 6 archivos de 20 MB
    // (120 MB) escritos directo al storage: se baja completo y cuadra.
    it("un zip grande (120 MB) sale completo", async () => {
      const emp = await empresa(`Lote 120MB ${marca}`);
      const MB20 = 20 * 1024 * 1024;
      for (let i = 0; i < 6; i++) await documentoDirecto(emp, `grande-${i}.pdf`, MB20);
      const res = await api().get("/api/v1/documentos/lote").set("Cookie", adminCookie).query({ empresaId: emp }).buffer(true).parse(binario);
      expect(res.status).toBe(200);
      expect(res.headers["content-length"]).toBeUndefined();
      const zip = res.body as Buffer;
      expect(entradasDelZip(zip)).toBe(6);
      // store: sin comprimir, así que pesa los 120 MB más encabezados.
      expect(zip.length).toBeGreaterThan(6 * MB20);
      expect(zip.length).toBeLessThan(6 * MB20 + 64 * 1024);
    }, 120_000);
  });
});
