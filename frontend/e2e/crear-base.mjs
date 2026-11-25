// Prepara la base de las pruebas de navegador (#15 de la revisión del 20-nov-2026):
// la BORRA y la vuelve a crear vacía, para que cada corrida empiece igual. Por eso
// solo acepta una base cuyo nombre diga "e2e" o "test". Las migraciones las aplica
// después src/database/migrate.ts (ver playwright.config.ts).
import { createRequire } from "node:module";

const require = createRequire(new URL("../../package.json", import.meta.url));
const mysql = require("mysql2/promise");

const url = new URL(process.env.DATABASE_URL ?? "");
const base = url.pathname.replace(/^\//, "");
if (!/e2e|test/.test(base)) {
  console.error(`La base de las pruebas de navegador debe llamarse con "e2e" o "test" (se borra en cada corrida): ${base}`);
  process.exit(1);
}
url.pathname = "/";
const conexion = await mysql.createConnection(url.toString());
await conexion.query(`DROP DATABASE IF EXISTS \`${base}\``);
await conexion.query(`CREATE DATABASE \`${base}\``);
await conexion.end();
console.log(`Base ${base} lista (vacía).`);
