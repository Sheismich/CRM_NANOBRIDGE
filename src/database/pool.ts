import mysql from "mysql2/promise";
import { env } from "../config/env.js";

export const pool = mysql.createPool(env.DATABASE_URL);

// Sin este listener, un error del pool (ej. el servidor cierra una
// conexión idle por wait_timeout, un blip de red, un restart de MySQL)
// llega a Node como un evento 'error' sin listeners -- eso lo trata como
// una excepción no capturada y tumba TODO el proceso, no solo la query que
// tenía esa conexión (hallazgo de code review, 14-sep-2026). mysql2 ya
// descarta la conexión rota del pool por su cuenta; aquí solo evitamos el
// crash y dejamos rastro.
//
// El tipo `Pool` de mysql2/promise no declara el evento 'error' en su
// `on()` (solo connection/acquire/release/enqueue) -- pool.pool es el Pool
// "core" (callback-style) que sí envuelve por dentro y cuyo `on()` sí
// acepta cualquier string de evento.
pool.pool.on("error", (error) => {
  console.error("[mysql pool] error de conexión (no fatal para el proceso):", error);
});
