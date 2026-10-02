import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { crearAgente, ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { borradoresCaptura } from "../src/database/schema.js";

// Importación CSV (C4 del plan de fixes, 2-oct-2026).
describe("importación CSV: columnas, duplicados ajenos, búsqueda y vencimiento", () => {
  let app: INestApplication;
  let adminCookie: string[];
  const db = testDb();

  beforeAll(async () => {
    app = await createTestApp();
    adminCookie = await ensureSeedAdmin(app);
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  const api = () => request(app.getHttpServer());
  const ENCABEZADO = "empresaNombreLegal,contactoNombre,correo,canalInicial";

  const importar = (cookie: string[], lineas: string[]) =>
    api().post("/api/v1/prospectos/importaciones").set("Cookie", cookie).attach("archivo", Buffer.from(lineas.join("\n")), "prueba.csv");

  const fila = (correo = `csv.${randomUUID()}@test.local`) => `Empresa CSV ${randomUUID()},Contacto CSV,${correo},correo`;

  describe("columnas", () => {
    // Antes una columna mal escrita ("correo electronico") se ignoraba en
    // silencio y una repetida pisaba a la primera sin avisar.
    it("una columna desconocida: 400 que dice cuál es y cuáles se aceptan", async () => {
      const res = await importar(adminCookie, [`${ENCABEZADO},correo electronico`, `${fila()},x@test.local`]);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("correo electronico");
      expect(res.body.message).toContain("empresaNombreLegal");
    });

    it("una columna repetida: 400", async () => {
      const res = await importar(adminCookie, [`${ENCABEZADO},correo`, `${fila()},otro@test.local`]);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("correo");
    });

    it("más de 40 columnas: 400", async () => {
      const extra = Array.from({ length: 40 }, (_, i) => `x${i}`).join(",");
      expect((await importar(adminCookie, [`${ENCABEZADO},${extra}`, fila()])).status).toBe(400);
    });

    it("columnas sin nombre al final (lo que agrega Excel) se ignoran", async () => {
      expect((await importar(adminCookie, [`${ENCABEZADO},,`, `${fila()},,`])).status).toBe(201);
    });
  });

  describe("duplicado contra el contacto de otro agente", () => {
    it("el agente no ve el id del contacto ajeno ni puede colgarse de él; un admin sí", async () => {
      const agenteA = await crearAgente(app, adminCookie, `csv.a.${randomUUID()}@test.local`);
      const agenteB = await crearAgente(app, adminCookie, `csv.b.${randomUUID()}@test.local`);
      const correo = `csv.ajeno.${randomUUID()}@test.local`;
      expect((await api().post("/api/v1/empresas").set("Cookie", agenteB).send({ nombreLegal: `Empresa de B ${randomUUID()}`, contactos: [{ nombre: "Contacto de B", correo }] })).status).toBe(201);

      const lote = await importar(agenteA, [ENCABEZADO, fila(correo)]);
      expect(lote.status).toBe(201);
      const comoAgente = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", agenteA);
      const [filaAgente] = comoAgente.body.filas as { id: number; estado: string; match_contacto_id: number | null; errores: { mensaje: string }[] }[];
      expect(filaAgente).toMatchObject({ estado: "duplicado", match_contacto_id: null });
      expect(filaAgente!.errores[0]!.mensaje).toContain("supervisor");

      const comoAdmin = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", adminCookie);
      expect(comoAdmin.body.filas[0].match_contacto_id).toEqual(expect.any(Number));

      const url = `/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${filaAgente!.id}/confirmar`;
      const intento = await api().post(url).set("Cookie", agenteA).send({ usarContactoExistente: true });
      expect(intento.status).toBe(409);
      expect(intento.body.code).toBe("CONTACTO_DE_OTRO_AGENTE");
      expect((await api().post(url).set("Cookie", adminCookie).send({ usarContactoExistente: true })).status).toBe(200);
    });
  });

  it("buscar '%' o '_' busca ese carácter, no 'cualquier cosa'", async () => {
    const lote = await importar(adminCookie, [ENCABEZADO, fila()]);
    const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", adminCookie);
    expect((await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${detalle.body.filas[0].id}/confirmar`).set("Cookie", adminCookie).send({})).status).toBe(200);

    for (const q of ["%", "_"]) {
      const res = await api().get("/api/v1/prospectos").set("Cookie", adminCookie).query({ q });
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    }
  });

  it("una fila vencida ya no se confirma: 409 con code", async () => {
    const lote = await importar(adminCookie, [ENCABEZADO, fila()]);
    const detalle = await api().get(`/api/v1/prospectos/importaciones/${lote.body.lote_id}`).set("Cookie", adminCookie);
    const id = detalle.body.filas[0].id as number;
    await db.update(borradoresCaptura).set({ expiraEn: new Date(Date.now() - 60_000) }).where(eq(borradoresCaptura.id, id));

    const res = await api().post(`/api/v1/prospectos/importaciones/${lote.body.lote_id}/filas/${id}/confirmar`).set("Cookie", adminCookie).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IMPORTACION_VENCIDA");
  });
});
