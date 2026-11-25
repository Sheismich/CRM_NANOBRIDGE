import { expect, request, test, type APIRequestContext } from "@playwright/test";
import { LLAVE_N8N } from "../playwright.config";

// El camino principal del CRM en un navegador de verdad (#15 de la revisión del
// 20-nov-2026): entrar, abrir la ficha de una empresa y mandar a su contacto a
// automatización. La base empieza vacía en cada corrida (ver playwright.config.ts);
// los datos se siembran por la API, igual que en producción.
const ADMIN = { nombre: "Admin E2E", correo: "admin.e2e@test.local", password: "password_e2e_admin_1" };

let api: APIRequestContext;
let prospectoId: number;
let empresaId: number;

test.beforeAll(async () => {
  api = await request.newContext({ baseURL: "http://localhost:3101" });
  expect((await api.post("/api/v1/auth/bootstrap", { data: ADMIN })).status()).toBe(201);
  expect((await api.post("/api/v1/auth/login", { data: { correo: ADMIN.correo, password: ADMIN.password } })).status()).toBe(200);

  const campana = await api.post("/api/v1/campanas", { data: { nombre: "Campaña E2E" } });
  expect(campana.status()).toBe(201);
  const campanaId = (await campana.json()).id as number;
  expect((await api.post(`/api/v1/campanas/${campanaId}/activar`)).ok()).toBe(true);

  const prospecto = await api.post("/api/v1/automatizacion/prospectos", {
    headers: { "X-API-Key": LLAVE_N8N },
    data: {
      execution_id: `e2e-${Date.now()}`,
      empresa: { nombreLegal: "Moldes E2E S.A. de C.V.", giro: "Manufactura", tamano: "mediana" },
      contacto: { nombre: "Paula Navegador", correo: "paula.e2e@destino.test" }
    }
  });
  expect(prospecto.status()).toBe(201);
  prospectoId = (await prospecto.json()).id as number;
  const detalle = await api.get(`/api/v1/prospectos/${prospectoId}`);
  empresaId = (await detalle.json()).empresa.id as number;
});

test.afterAll(async () => {
  await api.dispose();
});

test("entrar, abrir la ficha y mandar un prospecto a automatización", async ({ page }) => {
  await test.step("entrar", async () => {
    await page.goto("/login");
    await page.locator("#correo").fill(ADMIN.correo);
    await page.locator("#password").fill(ADMIN.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.getByText("Lo nuevo para ti")).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);
  });

  await test.step("abrir la ficha de la empresa", async () => {
    await page.goto(`/empresas/${empresaId}`);
    await expect(page.getByText("Moldes E2E S.A. de C.V.").first()).toBeVisible();
    await expect(page.getByText("Paula Navegador").first()).toBeVisible();
  });

  await test.step("mandar a automatización", async () => {
    await page.goto(`/prospectos?prospecto=${prospectoId}`);
    await page.getByRole("button", { name: "Mandar a automatización" }).last().click();
    await page.locator("#campana-fila").selectOption({ label: "Campaña E2E" });
    await page.getByRole("button", { name: "Mandar", exact: true }).click();
    await expect(page.getByText("Entraron 1.")).toBeVisible();
    await page.getByRole("dialog", { name: "Listo" }).getByText("Cerrar", { exact: true }).click();

    // En la base quedó en la fila de esa campaña, y la pantalla lo dice.
    const detalle = await (await api.get(`/api/v1/prospectos/${prospectoId}`)).json();
    expect(detalle.estado).toBe("en_fila");
    await expect(page.getByText("En fila").first()).toBeVisible();
  });
});
