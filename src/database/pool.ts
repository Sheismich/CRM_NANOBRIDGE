import mysql from "mysql2/promise";
import { env } from "../config/env.js";

// Con las opciones por defecto, mysql2 guarda hasta 10 conexiones y nunca
// cierra las que se quedan sin usar (maxIdle = connectionLimit), y siempre
// reusa la última que se devolvió. Las demás se quedaban horas paradas,
// MySQL las cortaba de su lado (wait_timeout) y la API lo descubría hasta
// usarlas: PROTOCOL_CONNECTION_LOST en una petición real y /health fallando
// 10 veces seguidas, una por conexión muerta (alerta "CRM caído", 17 y
// 18-nov-2026). Ahora, pasado el pico, quedan a lo más 2 abiertas, y
// cualquiera que lleve 60 s sin usarse se cierra; la siguiente petición
// abre una nueva (unos milisegundos). enableKeepAlive ya viene encendido
// por defecto; se deja explícito. Las opciones del DATABASE_URL (ssl) se
// siguen leyendo de `uri`.
export const pool = mysql.createPool({
  uri: env.DATABASE_URL,
  connectionLimit: 10,
  maxIdle: 2,
  idleTimeout: 60_000,
  enableKeepAlive: true
});

// Drizzle lee y escribe los DATETIME como UTC (sin zona en la columna), y el
// SQL de la app usa CURRENT_TIMESTAMP/DATE_ADD del lado del servidor -- los
// dos lados solo coinciden si la sesión de MySQL está en UTC. Cloud SQL y el
// contenedor de pruebas ya lo están por defecto, pero un MySQL instalado en
// Windows/Linux toma la zona del sistema operativo (ej. UTC-6 en México) y
// las alertas SLA y métricas diarias quedaban
// desfasados esas horas (visto en 18-sep-2026 al correr la suite contra el
// MySQL local). mysql2 encola los comandos de cada conexión en orden, así
// que este SET corre antes que cualquier query que use esa conexión.
pool.pool.on("connection", (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

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
