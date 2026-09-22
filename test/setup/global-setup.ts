import { writeFile, unlink } from "node:fs/promises";
import mysql from "mysql2/promise";
import { applyMigrations } from "../../src/database/apply-migrations.js";
import { ENV_FILE } from "./shared-env-path.js";

// Corre UNA sola vez para toda la corrida de pruebas (Vitest globalSetup),
// antes de que se cargue cualquier archivo de prueba. Una sola base MySQL 8
// desechable para todos los archivos de prueba (levantarla por archivo sería
// más lento y no aporta aislamiento real: las pruebas ya corren secuenciales
// -- ver fileParallelism:false en vitest.config.ts).
//
// Por defecto es un contenedor mysql:8.0 (testcontainers). Si no hay Docker
// (ej. Windows sin WSL2) o se prefiere un MySQL ya levantado (un servicio de
// CI), TEST_DATABASE_URL apunta a uno: ver usarBaseExterna().
export default async function setup() {
  const externa = process.env.TEST_DATABASE_URL;
  const { databaseUrl, detener } = externa ? await usarBaseExterna(externa) : await levantarContenedor();

  // Si applyMigrations() truena (ej. una migración futura con un error de
  // SQL), Vitest nunca llega a recibir la función de teardown de abajo y el
  // contenedor se queda corriendo para siempre -- justo en el caso donde
  // más urge que sí se limpie solo para poder reintentar (hallazgo de
  // code-review, 15-sep-2026).
  try {
    const migrationPool = mysql.createPool(databaseUrl);
    await applyMigrations(migrationPool);
    await migrationPool.end();

    // setupFiles (test/setup/setup-env.ts) corre DENTRO del proceso/hilo de
    // cada archivo de prueba, en un contexto separado de este globalSetup --
    // no puede recibir estos datos por una variable en memoria. Se escriben a
    // un archivo temporal que setup-env.ts lee de forma síncrona antes de que
    // el archivo de prueba importe nada de src/ (y dispare la lectura de
    // src/config/env.ts).
    await writeFile(ENV_FILE, JSON.stringify({ DATABASE_URL: databaseUrl }), "utf8");
  } catch (error) {
    await detener();
    throw error;
  }

  return async () => {
    await unlink(ENV_FILE).catch(() => {});
    await detener();
  };
}

async function levantarContenedor() {
  // Import dinámico: con TEST_DATABASE_URL no hace falta cargar testcontainers.
  const { MySqlContainer } = await import("@testcontainers/mysql");
  const container = await new MySqlContainer("mysql:8.0")
    .withDatabase("nanobridge_test")
    .withUsername("nanobridge_test")
    .withUserPassword("nanobridge_test_pw")
    .withCommand(["--default-authentication-plugin=mysql_native_password"])
    .withStartupTimeout(120_000)
    .start();
  return { databaseUrl: container.getConnectionUri(), detener: () => container.stop().then(() => undefined) };
}

// Usa un MySQL ya levantado en vez de un contenedor. La base se BORRA y se
// recrea al inicio de cada corrida (las pruebas asumen una base vacía, igual
// que el contenedor nuevo), así que solo se acepta si su nombre contiene
// "test": apuntar esto por error a la base real del CRM sería destructivo.
async function usarBaseExterna(url: string) {
  const parsed = new URL(url);
  const nombre = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/test/i.test(nombre)) {
    throw new Error(`TEST_DATABASE_URL apunta a la base "${nombre}": por seguridad solo se aceptan bases cuyo nombre contenga "test", porque se borra y se recrea en cada corrida.`);
  }

  const sinBase = new URL(url);
  sinBase.pathname = "/";
  const admin = await mysql.createConnection(sinBase.toString());
  try {
    const base = admin.escapeId(nombre);
    await admin.query(`DROP DATABASE IF EXISTS ${base}`);
    await admin.query(`CREATE DATABASE ${base} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  } finally {
    await admin.end();
  }
  return { databaseUrl: url, detener: async () => {} };
}
