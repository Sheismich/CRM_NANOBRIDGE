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
    const statements = sql.split("-- statement-break").map((s) => s.trim()).filter(Boolean);
    const connection = await pool.getConnection();
    try {
      // beginTransaction()/rollback() NO protegen las sentencias DDL
      // (CREATE/ALTER/DROP TABLE, etc.): MySQL hace COMMIT implícito en
      // cada una, así que si la sentencia 2 de 4 falla, las primeras 2 ya
      // quedaron aplicadas de forma permanente y rollback() no las
      // deshace -- antes esto se ocultaba detrás de un try/rollback que
      // sugería atomicidad falsa (hallazgo de code review, 14-sep-2026).
      // No hay forma de arreglar esto desde el código: es una limitación
      // real de MySQL para DDL. Lo que sí se puede hacer es fallar con un
      // mensaje que diga EXACTAMENTE qué sentencia (de cuántas) fue la que
      // truena, para que quien migre sepa qué tanto del archivo ya quedó
      // aplicado en la base real y pueda decidir cómo seguir (completar a
      // mano, hacer las sentencias restantes idempotentes con
      // IF [NOT] EXISTS, etc.) en vez de asumir que "no pasó nada".
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

migrate().then(() => pool.end()).catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
