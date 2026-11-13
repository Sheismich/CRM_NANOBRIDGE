import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { INestApplication } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { createTestApp } from "./support/create-app.js";
import { closeTestDb, testDb } from "./support/db.js";
import { auditoria, listaSupresion, mediosContacto, prospectos, tareas } from "../src/database/schema.js";
import { leerTokenDeBaja, urlDeBaja } from "../src/shared/link-baja.js";

const API_KEY = "test_crm_callback_api_key_0001";
const MOTIVO = "Baja confirmada en la página de baja";

// 12-nov-2026: el escáner de links de Microsoft 365 abría el link de baja de
// SendGrid (que da de baja con solo abrirlo) y dos prospectos quedaron en
// baja 7 segundos después de recibir el correo. Ahora el link lleva a una
// página nuestra: abrirla no cambia nada, la baja ocurre al apretar el botón.
describe("página de baja propia (link del pie de los correos)", () => {
  let app: INestApplication;
  const db = testDb();
  const api = () => request(app.getHttpServer());
  const conLlave = <T extends { set: (k: string, v: string) => T }>(r: T) => r.set("X-API-Key", API_KEY);

  async function prospecto() {
    const correo = `baja.${randomUUID()}@pagina.test`;
    const telefono = `55${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`;
    const res = await conLlave(api().post("/api/v1/automatizacion/prospectos")).send({
      execution_id: randomUUID(),
      empresa: { nombreLegal: `Página Baja ${randomUUID().slice(0, 8)}`, giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Persona Baja", correo, telefono }
    });
    const id = res.body.id as number;
    await db.update(prospectos).set({ estado: "validado" }).where(eq(prospectos.id, id));
    const [fila] = await db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, id));
    return { id, contactoId: fila!.contactoId, correo, telefono };
  }

  const ruta = (prospectoId: number) => new URL(urlDeBaja(prospectoId)).pathname;
  const estado = async (id: number) => (await db.select({ estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, id)))[0]!.estado;
  const suprimidos = (contactoId: number) =>
    db.select({ tipo: mediosContacto.tipo }).from(mediosContacto).where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.estadoContacto, "no_contactar")));
  const enLista = (valor: string) => db.select().from(listaSupresion).where(eq(listaSupresion.valorNormalizado, valor));
  const bajasEnAuditoria = (id: number) =>
    db.select({ despues: auditoria.despues, usuarioId: auditoria.usuarioId }).from(auditoria).where(and(eq(auditoria.entidad, "prospecto"), eq(auditoria.entidadId, id), eq(auditoria.accion, "cambiar_estado_automatizacion")));

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await closeTestDb();
  });

  describe("el link firmado", () => {
    it("lleva al CRM, con el prospecto y una firma que no se puede adivinar", () => {
      expect(urlDeBaja(42)).toMatch(/^https:\/\/crm\.test\/api\/v1\/baja\/42\.[0-9a-f]{32}$/);
      expect(urlDeBaja(42)).toBe(urlDeBaja(42));
      expect(urlDeBaja(42).split(".").pop()).not.toBe(urlDeBaja(43).split(".").pop());
    });

    it("solo se lee si la firma es la suya", () => {
      const token = urlDeBaja(42).split("/").pop()!;
      const firma = token.split(".")[1]!;
      expect(leerTokenDeBaja(token)).toBe(42);
      expect(leerTokenDeBaja(`43.${firma}`)).toBeNull();
      expect(leerTokenDeBaja(`42.${"0".repeat(32)}`)).toBeNull();
      expect(leerTokenDeBaja("42")).toBeNull();
      expect(leerTokenDeBaja("basura")).toBeNull();
      expect(leerTokenDeBaja(`42.${firma}x`)).toBeNull();
    });
  });

  describe("el correo", () => {
    it("el que regresa POST /envios trae el link firmado del prospecto, ya no la etiqueta de SendGrid", async () => {
      const p = await prospecto();
      const executionId = randomUUID();
      const res = await conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: executionId, prospecto_id: p.id, canal: "correo" });
      expect(res.status).toBe(201);

      const url = urlDeBaja(p.id);
      expect(res.body.correo.texto).toContain(`¿Ya no quiere recibir estos correos? Darte de baja: ${url}`);
      expect(res.body.correo.html).toContain(`<a href="${url}"`);
      expect(res.body.correo.html).not.toContain("[darte_de_baja]");
      expect(res.body.correo.texto).not.toContain("[darte_de_baja]");

      // El reintento de n8n (mismo execution_id) trae el mismo link.
      const otraVez = await conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: executionId, prospecto_id: p.id, canal: "correo" });
      expect(otraVez.body.ya_existia).toBe(true);
      expect(otraVez.body.correo.html).toContain(`<a href="${url}"`);
    });
  });

  describe("abrir la página (GET)", () => {
    it("muestra el botón y NO da de baja: es lo que hace un escáner de links", async () => {
      const p = await prospecto();
      const res = await api().get(ruta(p.id));

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toMatch(/noindex/);
      expect(res.text).toContain("Confirmar baja");
      expect(res.text).toMatch(/<form[^>]+method="post"/i);

      expect(await estado(p.id)).toBe("validado");
      expect(await suprimidos(p.contactoId)).toHaveLength(0);
      expect(await enLista(p.correo)).toHaveLength(0);
    });

    it("abrirla muchas veces o con HEAD tampoco cambia nada", async () => {
      const p = await prospecto();
      for (let i = 0; i < 3; i++) await api().get(ruta(p.id));
      await api().head(ruta(p.id));
      expect(await estado(p.id)).toBe("validado");
      expect(await enLista(p.correo)).toHaveLength(0);
    });

    it("un link alterado o de un prospecto que no existe: página de enlace no válido", async () => {
      const p = await prospecto();
      const alterado = ruta(p.id).replace(/\.[0-9a-f]{4}/, ".zzzz");
      for (const mala of [alterado, "/api/v1/baja/basura", ruta(999999999)]) {
        const res = await api().get(mala);
        expect(res.status).toBe(404);
        expect(res.headers["content-type"]).toMatch(/text\/html/);
        expect(res.text).toContain("Este enlace no es válido");
        expect(res.text).not.toContain("Confirmar baja");
      }
    });
  });

  describe("apretar el botón (POST)", () => {
    it("da de baja a la persona completa y lo deja en el historial", async () => {
      const p = await prospecto();
      const seguimiento = await db.insert(tareas).values({ titulo: "Llamar", tipo: "seguimiento", prospectoId: p.id, contactoId: p.contactoId, fechaLimite: new Date(Date.now() + 86_400_000) });

      const res = await api().post(ruta(p.id)).type("form").send("");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toContain("Listo, se dio de baja");

      expect(await estado(p.id)).toBe("baja");
      // Todos sus medios, no solo el correo (regla del 24-sep-2026).
      expect((await suprimidos(p.contactoId)).map((m) => m.tipo).sort()).toEqual(["correo", "telefono"]);
      expect(await enLista(p.correo)).toHaveLength(1);
      expect((await enLista(p.correo))[0]!.motivo).toBe(MOTIVO);

      const [tarea] = await db.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, seguimiento[0].insertId));
      expect(tarea!.estado).toBe("cancelada");

      const rastro = await bajasEnAuditoria(p.id);
      expect(rastro).toHaveLength(1);
      expect(rastro[0]!.usuarioId).toBeNull();
      expect(rastro[0]!.despues).toMatchObject({ estado: "baja", motivo: MOTIVO });

      // Ya no se le puede escribir.
      const envio = await conLlave(api().post("/api/v1/automatizacion/envios")).send({ execution_id: randomUUID(), prospecto_id: p.id, canal: "correo" });
      expect(envio.status).toBe(409);
    });

    it("apretar dos veces da el mismo 'Listo' y no duplica nada", async () => {
      const p = await prospecto();
      expect((await api().post(ruta(p.id))).status).toBe(200);
      const segunda = await api().post(ruta(p.id));
      expect(segunda.status).toBe(200);
      expect(segunda.text).toContain("Listo, se dio de baja");
      expect(await enLista(p.correo)).toHaveLength(1);
      expect(await bajasEnAuditoria(p.id)).toHaveLength(1);
    });

    it("después de la baja, abrir el link otra vez dice que ya está dada de baja", async () => {
      const p = await prospecto();
      await api().post(ruta(p.id));
      const res = await api().get(ruta(p.id));
      expect(res.status).toBe(200);
      expect(res.text).toContain("Listo, se dio de baja");
      expect(res.text).not.toContain("Confirmar baja");
    });

    it("con un link alterado no da de baja a nadie", async () => {
      const p = await prospecto();
      const otro = await prospecto();
      // La firma de uno con el número del otro.
      const firma = ruta(p.id).split(".").pop()!;
      const res = await api().post(`/api/v1/baja/${otro.id}.${firma}`);
      expect(res.status).toBe(404);
      expect(res.text).toContain("Este enlace no es válido");
      expect(await estado(p.id)).toBe("validado");
      expect(await estado(otro.id)).toBe("validado");
    });

    it("el botón funciona aunque el navegador mande un origen raro (no usa sesión)", async () => {
      const p = await prospecto();
      const res = await api().post(ruta(p.id)).set("Origin", "null");
      expect(res.status).toBe(200);
      expect(await estado(p.id)).toBe("baja");

      // El resto de la API sigue revisando el origen.
      const login = await api().post("/api/v1/auth/login").set("Origin", "null").send({ correo: "x@test.local", password: "lo_que_sea_123" });
      expect(login.status).toBe(403);
    });
  });
});
