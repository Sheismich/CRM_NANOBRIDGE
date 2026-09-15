import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import * as schema from "../../src/database/schema.js";

// Conexión de pruebas APARTE de la que usa la app (src/database/pool.ts):
// no para mockear nada -- sigue siendo el mismo MySQL real del contenedor
// desechable (ver global-setup.ts) -- sino para que las pruebas puedan
// sembrar filas o "adelantar el reloj" de una columna (ej. proximo_intento_en
// del outbox) sin pasar por HTTP, cuando el flujo de negocio para llegar a
// ese estado sería mucho más largo que lo que la prueba necesita cubrir.
let pool: mysql.Pool | undefined;

export function testDb() {
  if (!pool) pool = mysql.createPool(process.env.DATABASE_URL!);
  return drizzle(pool, { schema, mode: "default" });
}

export async function closeTestDb() {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
