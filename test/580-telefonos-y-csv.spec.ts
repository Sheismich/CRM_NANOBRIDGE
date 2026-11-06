import { randomInt, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb } from "./support/db.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { normalizePhone, tieneDigitosSuficientes } from "../src/shared/normalize.js";
import { parseCsv } from "../src/shared/csv.js";

const API_KEY = "test_crm_callback_api_key_0001";

// Ensayo de la carga de la semana 12 (6-nov-2026): el mismo teléfono con y sin
// lada quedaba como dos, la extensión se pegaba al número y un CSV separado por
// punto y coma se rechazaba con un mensaje confuso.
describe("teléfonos con lada o extensión y CSV con punto y coma", () => {
  describe("normalizePhone", () => {
    it("quita la lada de México cuando deja 10 dígitos", () => {
      for (const v of ["81 1234 5678", "+52 81 1234 5678", "52 81 1234 5678", "+52 1 81 1234 5678", "0052 81 1234 5678", "00 52 1 81 1234 5678", "(81) 1234-5678"]) {
        expect(normalizePhone(v), v).toBe("8112345678");
      }
    });

    it("quita la extensión al final", () => {
      for (const v of ["999 123 4567 ext 12", "999 123 4567 ext. 12", "999-123-4567 Ext: 12", "999 123 4567 extensión 12", "999 123 4567 x12", "9991234567 #12", "+52 999 123 4567 ext 1234"]) {
        expect(normalizePhone(v), v).toBe("9991234567");
      }
    });

    it("no toca lo que no es una lada de México de 10 dígitos", () => {
      expect(normalizePhone("1 (512) 555-0101")).toBe("15125550101"); // Estados Unidos
      expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958"); // 12 dígitos, pero no empieza con 52
      expect(normalizePhone("52 9999")).toBe("529999"); // corto
      expect(normalizePhone("5212345678")).toBe("5212345678"); // 10 dígitos que empiezan con 52: un número local
      expect(normalizePhone("no-phone")).toBe("");
    });

    it("la extensión no cuenta para los 7 dígitos mínimos", () => {
      expect(tieneDigitosSuficientes("123 ext 4567")).toBe(false);
      expect(tieneDigitosSuficientes("442 555 0101 ext 12")).toBe(true);
    });
  });

  describe("parseCsv", () => {
    it("lee un CSV separado por punto y coma, con comas y punto y coma dentro de comillas", () => {
      const { encabezados, filas } = parseCsv("﻿empresaNombreLegal;contactoNombre;observaciones\r\nMoldes, S.A. de C.V.;Jorge Muñoz;\"dijo: llamar; no escribir\"\r\n");
      expect(encabezados).toEqual(["empresaNombreLegal", "contactoNombre", "observaciones"]);
      expect(filas).toEqual([{ empresaNombreLegal: "Moldes, S.A. de C.V.", contactoNombre: "Jorge Muñoz", observaciones: "dijo: llamar; no escribir" }]);
    });

    it("sigue leyendo comas cuando un dato trae punto y coma", () => {
      const { filas } = parseCsv("empresaNombreLegal,observaciones\nAceros,uno; dos\n");
      expect(filas).toEqual([{ empresaNombreLegal: "Aceros", observaciones: "uno; dos" }]);
    });
  });

  describe("con la base", () => {
    let app: INestApplication;
    let admin: string[];
    const api = () => request(app.getHttpServer());
    const telefono = () => `55${String(randomInt(10_000_000, 99_999_999))}`;

    beforeAll(async () => {
      app = await createTestApp();
      admin = await ensureSeedAdmin(app);
    });

    afterAll(async () => {
      await app.close();
      await closeTestDb();
    });

    it("una fila importada con +52 es duplicada de la persona que ya está sin lada", async () => {
      const tel = telefono();
      const alta = await api().post("/api/v1/empresas").set("Cookie", admin).send({
        nombreLegal: `Lada ${randomUUID().slice(0, 8)}`,
        contactos: [{ nombre: "Persona Conmutador", telefono: `${tel.slice(0, 2)} ${tel.slice(2, 6)} ${tel.slice(6)}` }]
      });
      expect(alta.status).toBe(201);

      const csv = ["empresaNombreLegal;contactoNombre;telefono;canalInicial", `Otra;Persona Repetida;+52 1 ${tel} ext 3;telefono`].join("\r\n");
      const res = await api().post("/api/v1/prospectos/importaciones").set("Cookie", admin).attach("archivo", Buffer.from(csv, "utf8"), "punto-y-coma.csv");
      expect(res.status).toBe(201);
      expect(res.body.resumen).toEqual({ duplicado: 1 });

      const lote = await api().get(`/api/v1/prospectos/importaciones/${res.body.lote_id}`).set("Cookie", admin);
      expect(lote.body.filas[0]).toMatchObject({ estado: "duplicado", match_motivo: "telefono" });
    });

    it("una baja por teléfono con lada también bloquea el número escrito sin lada", async () => {
      const tel = telefono();
      const baja = await api().post("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY)
        .send({ execution_id: randomUUID(), tipo: "telefono", valor: `+52 ${tel}`, motivo: "pidió no ser contactado" });
      expect(baja.status).toBeLessThan(300);

      const consulta = await api().get("/api/v1/automatizacion/supresion").set("X-API-Key", API_KEY).query({ tipo: "telefono", valor: `(${tel.slice(0, 2)}) ${tel.slice(2, 6)}-${tel.slice(6)}` });
      expect(consulta.body.en_supresion).toBe(true);
    });
  });
});
