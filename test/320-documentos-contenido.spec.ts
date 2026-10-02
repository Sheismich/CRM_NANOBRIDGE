import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Documentos (C5 del plan de fixes, 2-oct-2026): el tipo se creía al
// navegador (un HTML o un .exe declarado "application/pdf" se guardaba), el
// nombre de descarga conservaba la extensión que mandara quien subió, y se
// podía marcar revisada una versión obsoleta o archivada.
const PDF = Buffer.from("%PDF-1.4 contenido");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
// Un .docx/.xlsx es un ZIP; los nombres de sus partes van en texto plano.
const zipCon = (ruta: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`....${ruta}document.xml....`)]);
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("documentos: tipo real, nombre de descarga y revisión", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const empresa = await api().post("/api/v1/empresas").set("Cookie", adminCookie).send({ nombreLegal: `Empresa Docs C5 ${randomUUID()}`, contactos: [{ nombre: "Contacto", correo: `docs.c5.${randomUUID()}@test.local` }] });
    empresaId = empresa.body.id as number;
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());
  const subir = (buffer: Buffer, filename: string, contentType: string) =>
    api().post("/api/v1/documentos").set("Cookie", adminCookie).field("empresaId", String(empresaId)).attach("archivo", buffer, { filename, contentType });

  describe("el contenido tiene que ser del tipo declarado", () => {
    it.each([
      ["texto declarado PDF", Buffer.from("no soy un pdf"), "a.pdf", "application/pdf"],
      ["HTML declarado PNG", Buffer.from("<html><script>alert(1)</script></html>"), "a.png", "image/png"],
      ["PDF declarado JPG", PDF, "a.jpg", "image/jpeg"],
      ["ZIP sin word/ declarado DOCX", zipCon("xl/"), "a.docx", DOCX],
      ["ZIP sin xl/ declarado XLSX", zipCon("word/"), "a.xlsx", XLSX]
    ] as const)("%s: 400", async (_caso, buffer, filename, tipo) => {
      const res = await subir(buffer, filename, tipo);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/no corresponde/);
    });

    it.each([
      ["PDF", PDF, "a.pdf", "application/pdf"],
      ["PNG", PNG, "a.png", "image/png"],
      ["JPG", JPG, "a.jpg", "image/jpeg"],
      ["DOCX", zipCon("word/"), "a.docx", DOCX],
      ["XLSX", zipCon("xl/"), "a.xlsx", XLSX]
    ] as const)("%s real: 201", async (_caso, buffer, filename, tipo) => {
      expect((await subir(buffer, filename, tipo)).status).toBe(201);
    });
  });

  describe("nombre de descarga", () => {
    const nombreDescargado = async (id: number) => {
      const res = await api().get(`/api/v1/documentos/${id}/descarga`).set("Cookie", adminCookie);
      expect(res.status).toBe(200);
      return decodeURIComponent(/filename\*=UTF-8''(.+)$/.exec(res.headers["content-disposition"] as string)![1]!);
    };

    it("si el nombre no termina en la extensión del tipo validado, se le agrega", async () => {
      const res = await subir(PDF, "factura.exe", "application/pdf");
      expect(res.status).toBe(201);
      expect(await nombreDescargado(res.body.id)).toBe("factura.exe.pdf");
    });

    it("si ya la trae (en mayúsculas o .jpeg), se queda igual", async () => {
      expect(await nombreDescargado((await subir(PDF, "Contrato Final.PDF", "application/pdf")).body.id)).toBe("Contrato Final.PDF");
      expect(await nombreDescargado((await subir(JPG, "foto.jpeg", "image/jpeg")).body.id)).toBe("foto.jpeg");
    });
  });

  describe("revisar", () => {
    const revisar = (id: number) => api().patch(`/api/v1/documentos/${id}/revisar`).set("Cookie", adminCookie).send({});

    it("solo la versión vigente; una obsoleta o archivada responde 409 con code", async () => {
      const v1 = (await subir(PDF, "v1.pdf", "application/pdf")).body.id as number;
      const v2 = await api().post(`/api/v1/documentos/${v1}/version`).set("Cookie", adminCookie).attach("archivo", PDF, { filename: "v2.pdf", contentType: "application/pdf" });
      expect(v2.status).toBe(201);

      const obsoleta = await revisar(v1);
      expect(obsoleta.status).toBe(409);
      expect(obsoleta.body.code).toBe("DOCUMENTO_NO_VIGENTE");
      expect((await revisar(v2.body.id)).status).toBe(200);

      expect((await api().patch(`/api/v1/documentos/${v2.body.id}/estado`).set("Cookie", adminCookie).send({ estado: "archivado" })).status).toBe(200);
      expect((await revisar(v2.body.id)).status).toBe(409);
    });

    it("revisar dos veces seguidas la vigente no da un 409 falso", async () => {
      const id = (await subir(PDF, "doble.pdf", "application/pdf")).body.id as number;
      const [a, b] = [await revisar(id), await revisar(id)];
      expect([a.status, b.status]).toEqual([200, 200]);
    });
  });
});
