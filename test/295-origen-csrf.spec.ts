import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { INestApplication } from "@nestjs/common";
import { createTestApp } from "./support/create-app.js";
import { ensureSeedAdmin } from "./support/seed.js";
import { closeTestDb, testDb } from "./support/db.js";
import { campanas } from "../src/database/schema.js";
import { origenPermitido } from "../src/shared/origen-csrf.js";

// Mismo valor fijado en test/setup/setup-env.ts.
const API_KEY = "test_crm_callback_api_key_0001";
const AJENO = "https://otro.nano-bridge-mex.com";

// CSRF (B9 del plan de fixes, 2-oct-2026). La cookie de sesión es
// SameSite=Lax: frena a sitios ajenos, pero NO a otros subdominios del mismo
// dominio. Un formulario escondido en uno de ellos podía hacer que el
// navegador de alguien con sesión subiera un documento o finalizara una
// campaña. Las peticiones que cambian datos y traen Origin solo pasan si el
// origen es el del CRM.
describe("origen de las peticiones que cambian datos (CSRF)", () => {
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

  it("con sesión y desde otro origen: 403 con code, y no se crea nada", async () => {
    const nombre = `Campaña CSRF ${randomUUID()}`;
    const res = await api().post("/api/v1/campanas").set("Cookie", adminCookie).set("Origin", AJENO).send({ nombre });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "request_error", code: "ORIGEN_NO_PERMITIDO" });
    expect(await db.select().from(campanas).where(eq(campanas.nombre, nombre))).toHaveLength(0);
  });

  it("Origin: null (iframe aislado, redirecciones raras) también es 403", async () => {
    const res = await api().post("/api/v1/auth/logout").set("Cookie", adminCookie).set("Origin", "null");
    expect(res.status).toBe(403);
  });

  it("el login desde otro origen también se frena (no te pueden iniciar sesión en otra cuenta)", async () => {
    const res = await api().post("/api/v1/auth/login").set("Origin", AJENO).send({ correo: "x@test.local", password: "lo_que_sea_123" });
    expect(res.status).toBe(403);
  });

  it("el mismo origen pasa: por Sec-Fetch-Site o porque coincide con el host de la API", async () => {
    const porNavegador = await api().post("/api/v1/campanas").set("Cookie", adminCookie).set("Origin", "https://crm.nano-bridge-mex.com").set("Sec-Fetch-Site", "same-origin").send({ nombre: `Campaña ${randomUUID()}` });
    expect(porNavegador.status).toBe(201);

    const porHost = await api().post("/api/v1/campanas").set("Cookie", adminCookie).set("Host", "api.nano-bridge-mex.com").set("Origin", "https://api.nano-bridge-mex.com").send({ nombre: `Campaña ${randomUUID()}` });
    expect(porHost.status).toBe(201);
  });

  it("sin Origin (n8n, curl) todo sigue igual; los GET tampoco se revisan", async () => {
    const n8n = await api().post("/api/v1/automatizacion/jobs/no-existe").set("X-API-Key", API_KEY);
    expect(n8n.status).toBe(404);
    expect((await api().get("/api/v1/campanas").set("Cookie", adminCookie).set("Origin", AJENO)).status).toBe(200);
  });

  // La lista CORS_ORIGINS en los tests está vacía, así que esa rama se
  // prueba directo sobre la función.
  describe("origenPermitido", () => {
    const base = { metodo: "POST", origin: AJENO, secFetchSite: undefined, host: "api.nano-bridge-mex.com" };

    it.each([
      ["sin Origin", { origin: undefined }, true],
      ["GET", { metodo: "GET" }, true],
      ["HEAD", { metodo: "HEAD" }, true],
      ["OPTIONS (preflight de CORS)", { metodo: "OPTIONS" }, true],
      ["origen en CORS_ORIGINS", { origin: "https://crm.nano-bridge-mex.com" }, true],
      ["Sec-Fetch-Site same-origin", { secFetchSite: "same-origin" }, true],
      ["Sec-Fetch-Site same-site (otro subdominio)", { secFetchSite: "same-site" }, false],
      ["origen ajeno", {}, false],
      ["Origin null", { origin: "null" }, false],
      ["Origin que no es URL", { origin: "basura" }, false],
      ["DELETE ajeno", { metodo: "DELETE" }, false],
      ["PATCH ajeno", { metodo: "PATCH" }, false]
    ] as const)("%s", (_caso, cambios, esperado) => {
      expect(origenPermitido({ ...base, ...cambios }, ["https://crm.nano-bridge-mex.com"])).toBe(esperado);
    });
  });
});
