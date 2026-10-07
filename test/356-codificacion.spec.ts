import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb } from "./support/db.js";

// Texto que no llega en UTF-8 (7-oct-2026). El primer admin quedó como
// "Fabi�n": la terminal mandó el JSON en otra codificación y la API cambió en
// silencio los bytes que no entendió por "�" (355-acentos prueba que con
// UTF-8 sí funciona). Ahora:
// - un JSON que no es UTF-8 se rechaza con 400 en vez de guardarse roto;
// - un CSV que no es UTF-8 se lee como Windows-1252, que es como lo guarda
//   Excel en español ("CSV delimitado por comas").
describe("codificación: el texto que no es UTF-8 no se guarda roto", () => {
  let app: INestApplication;
  let adminCookie: string[];

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());

  it("un JSON en Latin-1 / Windows-1252 responde 400 TEXTO_NO_UTF8", async () => {
    const cuerpo = Buffer.from(JSON.stringify({ nombreLegal: `Compañía ${randomUUID()}`, contactos: [{ nombre: "José", correo: `cod.${randomUUID()}@test.local` }] }), "latin1");
    // serialize: que supertest mande los bytes tal cual (si no, convierte el Buffer a JSON).
    const res = await api().post("/api/v1/empresas").set("Cookie", adminCookie).set("Content-Type", "application/json").serialize((b: unknown) => b as string).send(cuerpo);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "request_error", code: "TEXTO_NO_UTF8" });
  });

  async function importarYLeer(contenido: Buffer) {
    const res = await api().post("/api/v1/prospectos/importaciones").set("Cookie", adminCookie).attach("archivo", contenido, "codificacion.csv");
    expect(res.status).toBe(201);
    const detalle = await api().get(`/api/v1/prospectos/importaciones/${res.body.lote_id}`).set("Cookie", adminCookie);
    expect(detalle.status).toBe(200);
    return detalle.body.filas[0] as { empresa_nombre_legal: string; contacto_nombre: string };
  }

  it("un CSV guardado por Excel en Windows-1252 se lee con sus acentos y eñes", async () => {
    const sufijo = randomUUID().slice(0, 8);
    const texto = ["empresaNombreLegal,contactoNombre,correo,canalInicial", `Compañía Peña ${sufijo},José Núñez,cod1.${sufijo}@test.local,correo`].join("\r\n");
    const fila = await importarYLeer(Buffer.from(texto, "latin1"));
    expect(fila.empresa_nombre_legal).toBe(`Compañía Peña ${sufijo}`);
    expect(fila.contacto_nombre).toBe("José Núñez");
  });

  it("un CSV en UTF-8 (con o sin BOM) se sigue leyendo igual", async () => {
    const sufijo = randomUUID().slice(0, 8);
    const texto = ["empresaNombreLegal,contactoNombre,correo,canalInicial", `Güereña Ñandú ${sufijo},Ángela Peña,cod2.${sufijo}@test.local,correo`].join("\r\n");
    const fila = await importarYLeer(Buffer.from("﻿" + texto, "utf8"));
    expect(fila.empresa_nombre_legal).toBe(`Güereña Ñandú ${sufijo}`);
    expect(fila.contacto_nombre).toBe("Ángela Peña");
  });
});
