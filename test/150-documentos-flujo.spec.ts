import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createHmac } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, documentos } from "../src/database/schema.js";
import { env } from "../src/config/env.js";
import { LocalStorageDriver } from "../src/documentos/storage/local-storage.driver.js";

// Validación de archivos, estados, versionado, revisión, eliminación,
// descarga con sesión y scoping. 110-documentos-tipo.spec.ts ya
// cubre el catálogo de tipos y 120-alertas-jobs.spec.ts el job de alertas.
describe("documentos: archivos, estados, versionado y descarga", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let adminId: number;
  let empresaId: number;
  const sufijo = Date.now();
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
    const me = await request(app.getHttpServer()).get("/api/v1/auth/me").set("Cookie", adminCookie);
    adminId = me.body.id;
    empresaId = await crearEmpresa(adminCookie, `Empresa Documentos ${sufijo}`, `documentos.${sufijo}@test.local`);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  async function crearEmpresa(cookie: string[], nombreLegal: string, correo: string) {
    const res = await request(app.getHttpServer()).post("/api/v1/empresas").set("Cookie", cookie).send({ nombreLegal, contactos: [{ nombre: "Contacto Documentos", correo }] });
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  type Archivo = { buffer?: Buffer; filename?: string; contentType?: string };

  function subir(cookie: string[], fields: Record<string, string | number> = {}, archivo: Archivo | null = {}) {
    let req = request(app.getHttpServer()).post("/api/v1/documentos").set("Cookie", cookie).field("empresaId", String(fields.empresaId ?? empresaId));
    for (const [key, value] of Object.entries(fields)) if (key !== "empresaId") req = req.field(key, String(value));
    if (archivo) req = req.attach("archivo", archivo.buffer ?? Buffer.from("%PDF-1.4 contenido de prueba"), { filename: archivo.filename ?? "prueba.pdf", contentType: archivo.contentType ?? "application/pdf" });
    return req;
  }

  async function subirOk(cookie: string[] = adminCookie, fields: Record<string, string | number> = {}, archivo: Archivo = {}) {
    const res = await subir(cookie, fields, archivo);
    expect(res.status).toBe(201);
    return res.body.id as number;
  }

  function version(cookie: string[], id: number, archivo: Archivo | null = { buffer: Buffer.from("%PDF-1.4 version nueva"), filename: "v2.pdf" }, fields: Record<string, string> = {}) {
    let req = request(app.getHttpServer()).post(`/api/v1/documentos/${id}/version`).set("Cookie", cookie);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, value);
    if (archivo) req = req.attach("archivo", archivo.buffer ?? Buffer.from("%PDF-1.4 x"), { filename: archivo.filename ?? "v.pdf", contentType: archivo.contentType ?? "application/pdf" });
    return req;
  }

  function estado(cookie: string[], id: number, nuevo: string) {
    return request(app.getHttpServer()).patch(`/api/v1/documentos/${id}/estado`).set("Cookie", cookie).send({ estado: nuevo });
  }

  async function detalle(cookie: string[], id: number) {
    const res = await request(app.getHttpServer()).get(`/api/v1/documentos/${id}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body;
  }

  describe("validación del archivo al subir", () => {
    it("rechaza con 400: sin archivo, tipo no permitido, vacío y nombre demasiado largo", async () => {
      expect((await subir(adminCookie, {}, null)).status).toBe(400);
      expect((await subir(adminCookie, {}, { contentType: "text/plain", filename: "notas.txt" })).status).toBe(400);
      expect((await subir(adminCookie, {}, { contentType: "application/x-msdownload", filename: "virus.pdf" })).status).toBe(400);
      expect((await subir(adminCookie, {}, { buffer: Buffer.alloc(0) })).status).toBe(400);
      expect((await subir(adminCookie, {}, { filename: `${"a".repeat(252)}.pdf` })).status).toBe(400);
    });

    it("rechaza con 400 un archivo por encima del tamaño máximo", async () => {
      const res = await subir(adminCookie, {}, { buffer: Buffer.alloc((env.STORAGE_MAX_FILE_SIZE_MB + 1) * 1024 * 1024) });
      expect(res.status).toBe(400);
    });

    it("acepta los cinco tipos permitidos", async () => {
      // Desde C5 (2-oct-2026) el contenido tiene que ser del tipo declarado.
      const zip = (carpeta: string) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(`${carpeta}document.xml`)]);
      const tipos: [string, string, Buffer][] = [
        ["a.pdf", "application/pdf", Buffer.from("%PDF-1.4 a")],
        ["b.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip("word/")],
        ["c.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", zip("xl/")],
        ["d.png", "image/png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        ["e.jpg", "image/jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0])]
      ];
      for (const [filename, contentType, buffer] of tipos) {
        expect((await subir(adminCookie, {}, { filename, contentType, buffer })).status).toBe(201);
      }
    });

    it("la extensión guardada sale del mimetype validado, no del nombre que manda el cliente", async () => {
      const id = await subirOk(adminCookie, {}, { filename: "shell.php", contentType: "image/png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) });
      const [fila] = await db.select().from(documentos).where(eq(documentos.id, id));
      expect(fila!.storageKey).toMatch(new RegExp(`^documentos/${empresaId}/[0-9a-f-]{36}\\.png$`));
      expect(fila!.nombreOriginal).toBe("shell.php");
    });

    it("una empresa, oportunidad, contacto o tipo inexistentes responden 404 y no crean nada", async () => {
      expect((await subir(adminCookie, { empresaId: 999999 })).status).toBe(404);
      expect((await subir(adminCookie, { oportunidadId: 999999 })).status).toBe(404);
      expect((await subir(adminCookie, { contactoId: 999999 })).status).toBe(404);
      expect((await subir(adminCookie, { tipoDocumentoId: 999999 })).status).toBe(404);
    });

    it("guarda la política de retención desde la primera versión", async () => {
      const id = await subirOk(adminCookie, { politicaRetencion: "5_anios" });
      expect((await detalle(adminCookie, id)).politica_retencion).toBe("5_anios");
    });
  });

  describe("estados", () => {
    it("vigente ⇄ archivado; lo demás es 409/400", async () => {
      const id = await subirOk();
      expect((await detalle(adminCookie, id)).estado).toBe("vigente");

      expect((await estado(adminCookie, id, "vigente")).status).toBe(409);
      const archivado = await estado(adminCookie, id, "archivado");
      expect(archivado.status).toBe(200);
      expect(archivado.body.estado).toBe("archivado");
      expect((await estado(adminCookie, id, "archivado")).status).toBe(409);

      const vigente = await estado(adminCookie, id, "vigente");
      expect(vigente.status).toBe(200);
      expect(vigente.body.estado).toBe("vigente");

      // 'obsoleto' solo lo fija una nueva versión.
      expect((await estado(adminCookie, id, "obsoleto")).status).toBe(400);
      expect((await estado(adminCookie, id, "inventado")).status).toBe(400);
    });

    it("volver a 'vigente' limpia alertado_en para que el job de pendientes pueda alertarlo de nuevo", async () => {
      const id = await subirOk();
      await db.update(documentos).set({ alertadoEn: new Date() }).where(eq(documentos.id, id));

      await estado(adminCookie, id, "archivado");
      await estado(adminCookie, id, "vigente");

      const [fila] = await db.select().from(documentos).where(eq(documentos.id, id));
      expect(fila!.alertadoEn).toBeNull();
    });

    it("un documento obsoleto no cambia de estado", async () => {
      const id = await subirOk();
      await version(adminCookie, id);
      expect((await estado(adminCookie, id, "vigente")).status).toBe(409);
      expect((await estado(adminCookie, id, "archivado")).status).toBe(409);
    });
  });

  describe("versionado", () => {
    it("la versión anterior queda obsoleta, la raíz se conserva y se heredan tipo y retención", async () => {
      const catalogos = await request(app.getHttpServer()).get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
      const contrato = catalogos.body.tipos_documento.find((t: { clave: string }) => t.clave === "contrato");
      const v1 = await subirOk(adminCookie, { tipoDocumentoId: contrato.id, politicaRetencion: "10_anios" });

      const res2 = await version(adminCookie, v1);
      expect(res2.status).toBe(201);
      expect(res2.body.version).toBe(2);
      const v2 = res2.body.id as number;

      expect((await detalle(adminCookie, v1)).estado).toBe("obsoleto");

      const d2 = await detalle(adminCookie, v2);
      expect(d2.estado).toBe("vigente");
      expect(d2.version).toBe(2);
      expect(d2.documento_raiz_id).toBe(v1);
      expect(d2.tipo_documento_id).toBe(contrato.id);
      expect(d2.politica_retencion).toBe("10_anios");
      expect(d2.nombre_original).toBe("v2.pdf");

      const res3 = await version(adminCookie, v2, { buffer: Buffer.from("%PDF-1.4 v3"), filename: "v3.pdf" }, { politicaRetencion: "1_anio" });
      const d3 = await detalle(adminCookie, res3.body.id);
      expect(d3.documento_raiz_id).toBe(v1);
      expect(d3.politica_retencion).toBe("1_anio");
      expect(d3.versiones.map((v: { version: number; estado: string }) => [v.version, v.estado])).toEqual([
        [1, "obsoleto"],
        [2, "obsoleto"],
        [3, "vigente"]
      ]);
    });

    it("no se versiona un documento obsoleto, ni sin archivo, ni con un archivo inválido", async () => {
      const v1 = await subirOk();
      const { body } = await version(adminCookie, v1);

      expect((await version(adminCookie, v1)).status).toBe(409);
      expect((await version(adminCookie, body.id, null)).status).toBe(400);
      expect((await version(adminCookie, body.id, { contentType: "text/plain", filename: "x.txt" })).status).toBe(400);
    });

    it("el listado solo muestra la versión vigente de cada cadena", async () => {
      const otraEmpresa = await crearEmpresa(adminCookie, `Empresa Documentos Lista ${sufijo}`, `documentos.lista.${sufijo}@test.local`);
      const v1 = await subirOk(adminCookie, { empresaId: otraEmpresa });
      const { body } = await version(adminCookie, v1);

      const lista = await request(app.getHttpServer()).get(`/api/v1/documentos?empresaId=${otraEmpresa}`).set("Cookie", adminCookie);
      expect(lista.status).toBe(200);
      expect(lista.body.data.map((d: { id: number }) => d.id)).toEqual([body.id]);
    });

    it("dos versiones simultáneas del mismo documento: solo una gana", async () => {
      const v1 = await subirOk();
      const [a, b] = await Promise.all([version(adminCookie, v1), version(adminCookie, v1)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
    });
  });

  describe("revisión", () => {
    it("registra quién y cuándo revisó, con comentario, y lo deja en auditoría", async () => {
      const id = await subirOk();
      const antes = await detalle(adminCookie, id);
      expect(antes.revisado_por).toBeNull();
      expect(antes.revisado_en).toBeNull();

      const res = await request(app.getHttpServer()).patch(`/api/v1/documentos/${id}/revisar`).set("Cookie", adminCookie).send({ comentario: "Firmas completas" });
      expect(res.status).toBe(200);
      expect(res.body.revisado_por).toBe(adminId);
      expect(res.body.revisado_en).not.toBeNull();

      const [fila] = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "documento"), eq(auditoria.entidadId, id), eq(auditoria.accion, "revisar")));
      expect(fila!.usuarioId).toBe(adminId);
      expect((fila!.despues as { comentario: string }).comentario).toBe("Firmas completas");
    });

    it("se puede revisar sin comentario", async () => {
      const id = await subirOk();
      const res = await request(app.getHttpServer()).patch(`/api/v1/documentos/${id}/revisar`).set("Cookie", adminCookie).send({});
      expect(res.status).toBe(200);
      expect(res.body.revisado_por).toBe(adminId);
    });
  });

  describe("listado general (sin empresaId)", () => {
    it("un agente solo ve los documentos de sus empresas; cada fila trae empresa_nombre", async () => {
      const agente = await crearAgente(app, adminCookie, `docs.agente.lista.${sufijo}@test.local`);
      const empresaAgente = await crearEmpresa(agente, `Empresa Docs Agente ${sufijo}`, `docs.agente.empresa.${sufijo}@test.local`);
      const propio = await subirOk(agente, { empresaId: empresaAgente });
      const ajeno = await subirOk(adminCookie);

      const comoAgente = await request(app.getHttpServer()).get("/api/v1/documentos").query({ limit: 100 }).set("Cookie", agente);
      expect(comoAgente.status).toBe(200);
      const idsAgente = comoAgente.body.data.map((d: { id: number }) => d.id);
      expect(idsAgente).toContain(propio);
      expect(idsAgente).not.toContain(ajeno);
      expect(comoAgente.body.data.find((d: { id: number }) => d.id === propio).empresa_nombre).toBe(`Empresa Docs Agente ${sufijo}`);

      const comoAdmin = await request(app.getHttpServer()).get("/api/v1/documentos").query({ limit: 100 }).set("Cookie", adminCookie);
      expect(comoAdmin.body.data.map((d: { id: number }) => d.id)).toEqual(expect.arrayContaining([propio, ajeno]));
    });

    it("filtra por revisado y por estado", async () => {
      const revisado = await subirOk();
      const pendiente = await subirOk();
      expect((await request(app.getHttpServer()).patch(`/api/v1/documentos/${revisado}/revisar`).set("Cookie", adminCookie).send({})).status).toBe(200);

      const ids = async (query: Record<string, string>) =>
        (await request(app.getHttpServer()).get("/api/v1/documentos").query({ empresaId, limit: 100, ...query }).set("Cookie", adminCookie)).body.data.map((d: { id: number }) => d.id);
      expect(await ids({ revisado: "false" })).toContain(pendiente);
      expect(await ids({ revisado: "false" })).not.toContain(revisado);
      expect(await ids({ revisado: "true" })).toContain(revisado);

      expect((await estado(adminCookie, pendiente, "archivado")).status).toBe(200);
      expect(await ids({ estado: "archivado" })).toContain(pendiente);
      expect(await ids({ estado: "vigente" })).not.toContain(pendiente);
    });
  });

  describe("eliminación (baja lógica)", () => {
    it("solo administrador/supervisor; después el documento deja de existir para la API", async () => {
      const agente = await crearAgente(app, adminCookie, `docs.agente.eliminar.${sufijo}@test.local`);
      const id = await subirOk();

      const comoAgente = await request(app.getHttpServer()).delete(`/api/v1/documentos/${id}`).set("Cookie", agente);
      expect(comoAgente.status).toBe(403);
      expect((await request(app.getHttpServer()).get(`/api/v1/documentos/${id}`).set("Cookie", adminCookie)).status).toBe(200);

      expect((await request(app.getHttpServer()).delete(`/api/v1/documentos/${id}`).set("Cookie", adminCookie)).status).toBe(204);

      expect((await request(app.getHttpServer()).get(`/api/v1/documentos/${id}`).set("Cookie", adminCookie)).status).toBe(404);
      expect((await request(app.getHttpServer()).delete(`/api/v1/documentos/${id}`).set("Cookie", adminCookie)).status).toBe(404);
      expect((await request(app.getHttpServer()).get(`/api/v1/documentos/${id}/descarga`).set("Cookie", adminCookie)).status).toBe(404);

      // La fila sigue en la base (baja lógica) y quedó auditada.
      const [fila] = await db.select().from(documentos).where(eq(documentos.id, id));
      expect(fila!.activo).toBe(false);
      const auditadas = await db.select().from(auditoria).where(and(eq(auditoria.entidad, "documento"), eq(auditoria.entidadId, id), eq(auditoria.accion, "eliminar")));
      expect(auditadas).toHaveLength(1);
    });
  });

  describe("descarga a través de la API (con sesión)", () => {
    // B6 del plan de fixes (2-oct-2026): la API manda el archivo ella misma,
    // con la sesión del usuario. Ya no hay URL firmada: un enlace firmado
    // sirve a quien lo tenga, y en producción GCS ni siquiera podía firmarlo
    // (faltaba iam.serviceAccounts.signBlob → 500).
    const bajarArchivo = (cookie: string[] | undefined, id: number) => {
      const peticion = request(app.getHttpServer()).get(`/api/v1/documentos/${id}/descarga`);
      if (cookie) peticion.set("Cookie", cookie);
      return peticion.buffer(true).parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on("data", (parte: Buffer) => partes.push(parte));
        res.on("end", () => cb(null, Buffer.concat(partes)));
      });
    };
    const descargasAuditadas = (id: number) =>
      db.select().from(auditoria).where(and(eq(auditoria.entidad, "documento"), eq(auditoria.entidadId, id), eq(auditoria.accion, "descargar")));

    it("manda el archivo tal cual, como adjunto, sin caché y sin que el navegador adivine el tipo", async () => {
      const contenido = Buffer.from("%PDF-1.4 contenido real de la prueba");
      const id = await subirOk(adminCookie, {}, { buffer: contenido, filename: "Contrato final ñ.pdf" });

      const descarga = await bajarArchivo(adminCookie, id);
      expect(descarga.status).toBe(200);
      expect(Buffer.compare(descarga.body as Buffer, contenido)).toBe(0);
      expect(descarga.headers["content-type"]).toContain("application/pdf");
      expect(descarga.headers["content-length"]).toBe(String(contenido.length));
      expect(descarga.headers["content-disposition"]).toMatch(/^attachment; filename="Contrato final _\.pdf"; filename\*=UTF-8''Contrato%20final%20%C3%B1\.pdf$/);
      expect(descarga.headers["x-content-type-options"]).toBe("nosniff");
      expect(descarga.headers["cache-control"]).toBe("no-store");
      expect(await descargasAuditadas(id)).toHaveLength(1);
    });

    it("sin sesión responde 401 y no audita nada", async () => {
      const id = await subirOk();
      expect((await bajarArchivo(undefined, id)).status).toBe(401);
      expect(await descargasAuditadas(id)).toHaveLength(0);
    });

    it("la ruta pública de descarga por token ya no existe", async () => {
      expect((await request(app.getHttpServer()).get("/api/v1/storage/local/descarga?token=x.y")).status).toBe(404);
    });

    it("si el archivo ya no está en storage responde 404 (no 500) y no audita una descarga que no hubo", async () => {
      const id = await subirOk();
      const [fila] = await db.select().from(documentos).where(eq(documentos.id, id));
      await app.get(LocalStorageDriver).eliminar(fila!.storageKey);

      expect((await bajarArchivo(adminCookie, id)).status).toBe(404);
      expect(await descargasAuditadas(id)).toHaveLength(0);
    });

    it("el driver local no deja escapar rutas fuera de su directorio", async () => {
      const driver = app.get(LocalStorageDriver);
      const archivo = { buffer: Buffer.from("x"), mimeType: "application/pdf", tamanoBytes: 1 };
      await expect(driver.subir("../../fuera.pdf", archivo)).rejects.toMatchObject({ status: 400 });
      await expect(driver.subir("/etc/passwd", archivo)).rejects.toMatchObject({ status: 400 });
      await expect(driver.eliminar("../../fuera.pdf")).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("scoping por agente", () => {
    it("un agente solo opera sobre los documentos de SUS empresas; lo ajeno responde 404", async () => {
      const agente1 = await crearAgente(app, adminCookie, `docs.agente1.${sufijo}@test.local`);
      const agente2 = await crearAgente(app, adminCookie, `docs.agente2.${sufijo}@test.local`);
      const empresaAgente1 = await crearEmpresa(agente1, `Empresa Docs Agente 1 ${sufijo}`, `docs.agente1.contacto.${sufijo}@test.local`);
      const id = await subirOk(agente1, { empresaId: empresaAgente1 });

      const get = (cookie: string[], ruta = "") => request(app.getHttpServer()).get(`/api/v1/documentos/${id}${ruta}`).set("Cookie", cookie);
      expect((await get(agente1)).status).toBe(200);
      expect((await get(agente1, "/descarga")).status).toBe(200);

      expect((await get(agente2)).status).toBe(404);
      expect((await get(agente2, "/descarga")).status).toBe(404);
      expect((await estado(agente2, id, "archivado")).status).toBe(404);
      expect((await version(agente2, id)).status).toBe(404);
      expect((await request(app.getHttpServer()).patch(`/api/v1/documentos/${id}/revisar`).set("Cookie", agente2).send({})).status).toBe(404);
      expect((await subir(agente2, { empresaId: empresaAgente1 })).status).toBe(404);
      expect((await request(app.getHttpServer()).get(`/api/v1/documentos?empresaId=${empresaAgente1}`).set("Cookie", agente2)).status).toBe(404);

      // El propio dueño lista y el administrador ve cualquiera.
      const lista = await request(app.getHttpServer()).get(`/api/v1/documentos?empresaId=${empresaAgente1}`).set("Cookie", agente1);
      expect(lista.body.data.map((d: { id: number }) => d.id)).toEqual([id]);
      expect((await get(adminCookie)).status).toBe(200);
    });

    it("un documento de una empresa desactivada deja de ser visible", async () => {
      const otra = await crearEmpresa(adminCookie, `Empresa Docs Baja ${sufijo}`, `docs.baja.${sufijo}@test.local`);
      const id = await subirOk(adminCookie, { empresaId: otra });
      await request(app.getHttpServer()).delete(`/api/v1/empresas/${otra}`).set("Cookie", adminCookie);

      expect((await request(app.getHttpServer()).get(`/api/v1/documentos/${id}`).set("Cookie", adminCookie)).status).toBe(404);
      expect((await request(app.getHttpServer()).get(`/api/v1/documentos/${id}/descarga`).set("Cookie", adminCookie)).status).toBe(404);
    });

    it("sin sesión responde 401", async () => {
      expect((await request(app.getHttpServer()).get(`/api/v1/documentos?empresaId=${empresaId}`)).status).toBe(401);
      expect((await request(app.getHttpServer()).post("/api/v1/documentos")).status).toBe(401);
    });
  });
});
