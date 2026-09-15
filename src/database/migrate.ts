// A diferencia del resto de la app, este script corre fuera de Next.js
// (con tsx, vía `npm run migrate`), así que Next no le carga el .env por su
// cuenta. dotenv solo se usa aquí, no en src/config/env.ts.
import "dotenv/config";
import { pool } from "./pool.js";
import { applyMigrations } from "./apply-migrations.js";

// beginTransaction()/rollback() NO protegen las sentencias DDL (CREATE/
// ALTER/DROP TABLE, etc.): MySQL hace COMMIT implícito en cada una, así que
// si la sentencia 2 de 4 falla, las primeras 2 ya quedaron aplicadas de
// forma permanente y rollback() no las deshace -- antes esto se ocultaba
// detrás de un try/rollback que sugería atomicidad falsa (hallazgo de code
// review, 14-sep-2026). No hay forma de arreglar esto desde el código: es
// una limitación real de MySQL para DDL. applyMigrations() falla con un
// mensaje que dice EXACTAMENTE qué sentencia (de cuántas) fue la que
// truena, para que quien migre sepa qué tanto del archivo ya quedó
// aplicado en la base real y pueda decidir cómo seguir.
applyMigrations(pool).then(() => pool.end()).catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exitCode = 1;
});
