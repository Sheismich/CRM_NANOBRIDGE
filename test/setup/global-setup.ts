import { writeFile, unlink } from "node:fs/promises";
import mysql from "mysql2/promise";
import { MySqlContainer } from "@testcontainers/mysql";
import { applyMigrations } from "../../src/database/apply-migrations.js";
import { ENV_FILE } from "./shared-env-path.js";

// Corre UNA sola vez para toda la corrida de pruebas (Vitest globalSetup),
// antes de que se cargue cualquier archivo de prueba. Un solo contenedor
// MySQL 8 desechable para todos los archivos de prueba (levantarlo por
// archivo sería más lento y no aporta aislamiento real: las pruebas ya
// corren secuenciales -- ver fileParallelism:false en vitest.config.ts).
//
// Mismo contenedor mysql:8.0 que se usó a mano toda la sesión pasada para
// verificar cada feature -- esto solo automatiza ese mismo paso.
export default async function setup() {
  const container = await new MySqlContainer("mysql:8.0")
    .withDatabase("nanobridge_test")
    .withUsername("nanobridge_test")
    .withUserPassword("nanobridge_test_pw")
    .withCommand(["--default-authentication-plugin=mysql_native_password"])
    .withStartupTimeout(120_000)
    .start();

  // Si applyMigrations() truena (ej. una migración futura con un error de
  // SQL), Vitest nunca llega a recibir la función de teardown de abajo y el
  // contenedor se queda corriendo para siempre -- justo en el caso donde
  // más urge que sí se limpie solo para poder reintentar (hallazgo de
  // code-review, 15-sep-2026).
  try {
    const databaseUrl = container.getConnectionUri();
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
    await container.stop();
    throw error;
  }

  return async () => {
    await unlink(ENV_FILE).catch(() => {});
    await container.stop();
  };
}
