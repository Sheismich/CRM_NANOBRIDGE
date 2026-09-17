import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";

describe("catalogo_tipo_documento", () => {
  let app: INestApplication;
  let adminCookie: string[];
  let empresaId: number;

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);

    const empresa = await request(app.getHttpServer())
      .post("/api/v1/empresas")
      .set("Cookie", adminCookie)
      .send({ nombreLegal: "Empresa Documentos Tipo", contactos: [{ nombre: "Contacto Documentos", correo: `doc.tipo.${Date.now()}@test.local` }] });
    expect(empresa.status).toBe(201);
    empresaId = empresa.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  function subir(cookie: string[], fields: Record<string, string | number>) {
    let req = request(app.getHttpServer()).post("/api/v1/documentos").set("Cookie", cookie);
    for (const [key, value] of Object.entries(fields)) req = req.field(key, String(value));
    return req.attach("archivo", Buffer.from("contenido de prueba"), { filename: "prueba.pdf", contentType: "application/pdf" });
  }

  it("sin sesión responde 401", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/documentos/catalogos");
    expect(res.status).toBe(401);
  });

  it("devuelve el catálogo semilla, incluyendo 'otro'", async () => {
    const res = await request(app.getHttpServer()).get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
    expect(res.status).toBe(200);
    const claves = res.body.tipos_documento.map((t: { clave: string }) => t.clave);
    expect(claves).toEqual(expect.arrayContaining(["contrato", "identificacion_oficial", "comprobante_domicilio", "acta_constitutiva", "cotizacion_firmada", "otro"]));
  });

  it("subir un documento con un tipoDocumentoId inexistente responde 404, sin dejar el archivo huérfano en storage", async () => {
    const res = await subir(adminCookie, { empresaId, tipoDocumentoId: 999999 });
    expect(res.status).toBe(404);
  });

  it("subir con un tipoDocumentoId válido lo persiste; una nueva versión sin tipoDocumentoId hereda el de la versión anterior", async () => {
    const catalogos = await request(app.getHttpServer()).get("/api/v1/documentos/catalogos").set("Cookie", adminCookie);
    const contrato = catalogos.body.tipos_documento.find((t: { clave: string }) => t.clave === "contrato");

    const subida = await subir(adminCookie, { empresaId, tipoDocumentoId: contrato.id });
    expect(subida.status).toBe(201);

    const detalle = await request(app.getHttpServer()).get(`/api/v1/documentos/${subida.body.id}`).set("Cookie", adminCookie);
    expect(detalle.body.tipo_documento_id).toBe(contrato.id);

    const nuevaVersion = await request(app.getHttpServer())
      .post(`/api/v1/documentos/${subida.body.id}/version`)
      .set("Cookie", adminCookie)
      .attach("archivo", Buffer.from("contenido version 2"), { filename: "prueba-v2.pdf", contentType: "application/pdf" });
    expect(nuevaVersion.status).toBe(201);

    const detalleV2 = await request(app.getHttpServer()).get(`/api/v1/documentos/${nuevaVersion.body.id}`).set("Cookie", adminCookie);
    expect(detalleV2.body.tipo_documento_id).toBe(contrato.id);
  });
});
