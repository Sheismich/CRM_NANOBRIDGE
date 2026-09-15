import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "mysql2/promise";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

// Extraído de migrate.ts (hallazgo al montar el arnés de pruebas,
// 15-sep-2026) para que las pruebas de integración apliquen el MISMO
// esquema real, sentencia por sentencia, sin duplicar esta lógica -- migrate.ts
// y el setup global de Vitest llaman a esta misma función contra pools
// distintos (uno para la base real, otro para el contenedor MySQL
// desechable de pruebas).
export async function applyMigrations(pool: Pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const [existing] = await pool.query("SELECT version FROM schema_migrations WHERE version = ?", [file]);
    if (Array.isArray(existing) && existing.length > 0) continue;

    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    const statements = sql.split("-- statement-break").map((s) => s.trim()).filter(Boolean);
    const connection = await pool.getConnection();
    try {
      for (const [index, statement] of statements.entries()) {
        try {
          await connection.query(statement);
        } catch (error) {
          throw new Error(
            `${file}: falló la sentencia ${index + 1} de ${statements.length}. Las sentencias 1..${index} de este archivo (si son DDL) YA quedaron aplicadas en la base -- MySQL no permite deshacer DDL. Revisa el estado real de la base antes de reintentar.`,
            { cause: error }
          );
        }
      }
      await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      console.log(`Applied ${file}`);
    } finally {
      connection.release();
    }
  }
}
