import { afterAll, describe, expect, it } from "vitest";
import { pool } from "../src/database/pool.js";

// 17 y 18-nov-2026: la alerta "CRM caído" sonó dos veces y a un usuario le
// falló una petición con PROTOCOL_CONNECTION_LOST ("The server closed the
// connection"). Causa: con las opciones por defecto de mysql2 el pool guarda
// hasta 10 conexiones y NUNCA cierra las que se quedan sin usar (maxIdle =
// connectionLimit), y reusa siempre la última que se devolvió. Las demás se
// quedaban horas paradas, MySQL las cortaba de su lado (wait_timeout) y la
// API se enteraba hasta usarlas: /health falló 10 veces seguidas (una por
// conexión muerta) antes de volver solo.
//
// mysql2 no expone tipos para estas propiedades internas del pool.
type PoolInterno = {
  config: { connectionLimit: number; maxIdle: number; idleTimeout: number; connectionConfig: { enableKeepAlive: boolean } };
  _allConnections: { length: number };
  _freeConnections: { length: number };
};
const interno = pool.pool as unknown as PoolInterno;

afterAll(async () => {
  await pool.end();
});

describe("pool de MySQL: no guarda conexiones inactivas", () => {
  it("cierra las conexiones sin usar en vez de guardarlas indefinidamente", () => {
    expect(interno.config.maxIdle).toBeLessThan(interno.config.connectionLimit);
    expect(interno.config.idleTimeout).toBeLessThanOrEqual(60_000);
    expect(interno.config.connectionConfig.enableKeepAlive).toBe(true);
  });

  it("después de un pico, deja solo maxIdle conexiones abiertas", async () => {
    const conexiones = await Promise.all(Array.from({ length: 5 }, () => pool.getConnection()));
    for (const conexion of conexiones) conexion.release();
    expect(interno._freeConnections.length).toBe(5);

    // mysql2 revisa las inactivas cada segundo.
    await new Promise((resolve) => setTimeout(resolve, 2_500));

    expect(interno._freeConnections.length).toBeLessThanOrEqual(2);
    const [filas] = await pool.query("SELECT 1 AS uno");
    expect(filas).toEqual([{ uno: 1 }]);
  });
});
