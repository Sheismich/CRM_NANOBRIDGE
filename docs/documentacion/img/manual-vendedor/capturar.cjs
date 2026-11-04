// Capturas del manual del vendedor (MANUAL_DEL_VENDEDOR.md), sobre el CRM LOCAL
// con los datos de sembrar-ejemplo.py: nunca contra producción.
// Requisitos: API local en :3000, pantallas en :5173 (npx vite), Playwright
// (npm i playwright) y Microsoft Edge. Uso: node capturar.cjs <carpeta de salida>
const { chromium } = require("playwright");
const OUT = process.argv[2];
const B = "http://localhost:5173";
(async () => {
  const nav = await chromium.launch({ channel: "msedge" });
  const ctx = await nav.newContext({ viewport: { width: 1366, height: 820 }, deviceScaleFactor: 1.5, locale: "es-MX", timezoneId: "America/Mexico_City", colorScheme: "light" });
  const p = await ctx.newPage();
  const foto = async (nombre) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(700); await p.screenshot({ path: `${OUT}/${nombre}.jpg`, type: "jpeg", quality: 82 }); console.log("ok", nombre); };
  const ir = async (ruta, texto) => { await p.goto(B + ruta); if (texto) await p.getByText(texto).filter({ visible: true }).first().waitFor({ timeout: 15000 }); };

  await p.goto(B + "/login"); await foto("01-entrar");
  await p.getByLabel(/correo/i).fill("pasante@local.test");
  await p.locator("#password").fill("pasante12345");
  await p.getByRole("button", { name: /entrar|iniciar/i }).click();
  await p.waitForURL(B + "/");
  await foto("02-inicio");
  await ir("/tareas", "Mandar catálogo a Carlos"); await foto("03-mi-dia");
  await ir("/empresas", "Plásticos Querétaro"); await foto("04-empresas");
  await p.getByRole("button", { name: "+ Nueva empresa" }).click();
  await p.locator("#em-legal").fill("moldes del bajio");
  await p.getByText(/Ya hay .*empresa.* con este nombre/).filter({ visible: true }).first().waitFor({ timeout: 15000 });
  await foto("05-empresa-parecida");
  await ir("/empresas/2", "Ana López"); await foto("06-ficha");
  await p.getByRole("button", { name: "Dar de baja" }).nth(1).click();
  await p.locator("#motivo-baja").fill("Lo pidió por teléfono al vendedor");
  await foto("07-dar-de-baja");
  await p.keyboard.press("Escape");
  await ir("/prospectos", "Luis Pérez"); await foto("08-prospectos");
  await ir("/prospectos?tab=importaciones", "Marta Gil"); await foto("09-importaciones");
  await ir("/tareas?tab=cola", "Luis Pérez"); await foto("10-cola");
  await ir("/oportunidades", "Automatización de inyectoras"); await foto("11-oportunidades");
  await ir("/cotizaciones", "Aceros del Norte"); await foto("12-cotizaciones");
  await ir("/documentos", "constancia-fiscal-ejemplo"); await foto("13-documentos");
  await ir("/reportes?periodo=dia"); await foto("14-reportes-dia");
  await ir("/", null);
  await p.getByRole("button", { name: /buscar/i }).filter({ visible: true }).first().click();
  await p.getByPlaceholder(/Empresa, persona/).filter({ visible: true }).first().fill("aceros");
  await p.getByText("Aceros del Norte (ejemplo)").filter({ visible: true }).first().waitFor();
  await foto("15-buscar");
  await nav.close();
})().catch((e) => { console.error("ERROR:", e.message.split("\n")[0]); process.exit(1); });
