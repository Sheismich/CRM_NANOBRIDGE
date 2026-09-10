// A diferencia del resto de la app, este script corre fuera de Next.js
// (con tsx, vía `npm run migrate`), así que Next no le carga el .env por su
// cuenta. dotenv solo se usa aquí, no en src/config/env.ts.
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "migrations");

async function migrate() {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(255) PRIMARY KEY,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);

  const files = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    const [existing] = await pool.query("SELECT version FROM schema_migrations WHERE version = ?", [file]);
    if (Array.isArray(existing) && existing.length > 0) continue;

    const sql = await readFile(join(migrationsDirectory, file), "utf8");
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      for (const statement of sql.split("-- statement-break")) {
        if (statement.trim()) await connection.query(statement);
      }
      await connection.query("INSERT INTO schema_migrations (version) VALUES (?)", [file]);
      await connection.commit();
      console.log(`Applied ${file}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

migrate().then(() => pool.end()).catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
