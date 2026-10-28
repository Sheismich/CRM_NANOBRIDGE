// Borra los datos de PRUEBA antes del piloto (Manual de datos §8). Por omisión
// SOLO MUESTRA lo que borraría; no toca nada.
//
//   Ver:    LIMPIEZA_DB_URL="mysql://…" node docs/documentacion/limpiar-datos-prueba.mjs --empresas=1,6,7
//   Borrar: LIMPIEZA_DB_URL="mysql://…" LIMPIEZA_CONFIRMO=borrar-datos-de-prueba node docs/documentacion/limpiar-datos-prueba.mjs --empresas=1,6,7 --borrar
//
// Candados:
// - Solo borra las empresas que se le pasan con --empresas, y SOLO si cada una es
//   de prueba según los mismos criterios de auditar-datos.mjs (nombre con
//   "prueba", o algún medio .test / .local / +prueba). Si alguna no lo es, no
//   borra nada.
// - --borrar exige además LIMPIEZA_CONFIRMO=borrar-datos-de-prueba.
// - Todo en una transacción: si algo falla, no se borra nada.
// - No toca lista_supresion (una baja nunca se pierde) ni auditoria (la bitácora
//   no se borra), ni campañas, usuarios o catálogos.
// - Antes de borrar en producción: confirmar que hay respaldo del día (RUNBOOK §9).
// Deja un registro sin datos personales en docs/documentacion/auditorias/limpieza-<fecha>.md.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(AQUI, "..", "..", "package.json"));
const mysql = require("mysql2/promise");

const arg = (nombre) => process.argv.find((a) => a.startsWith(`--${nombre}`));
const pedidas = (arg("empresas")?.split("=")[1] ?? "").split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
const borrar = Boolean(arg("borrar"));
if (borrar && process.env.LIMPIEZA_CONFIRMO !== "borrar-datos-de-prueba") {
  console.error("Para borrar hace falta LIMPIEZA_CONFIRMO=borrar-datos-de-prueba. No se borró nada.");
  process.exit(1);
}

const url = new URL(process.env.LIMPIEZA_DB_URL ?? "");
const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: local ? undefined : { rejectUnauthorized: false }
});
// Lista para IN (?): vacía no es SQL válido, así que va con un id que no existe.
const en = (ids) => (ids.length ? [ids] : [[0]]);
const ids = async (sql, params) => [...new Set((await db.query(sql, params))[0].map((f) => Number(f.id)))].sort((a, b) => a - b);

// Mismos criterios que auditar-datos.mjs.
const ES_PRUEBA_MEDIO = "(m.valor_normalizado LIKE '%.test' OR m.valor_normalizado LIKE '%.local' OR m.valor_normalizado LIKE '%+prueba%' OR m.valor_normalizado LIKE '%@pruebas-nanobridge%')";
const candidatas = await ids(`
  SELECT id FROM empresas WHERE LOWER(nombre_legal) LIKE '%prueba%' OR LOWER(nombre_legal) IN ('no se','no se 2')
  UNION SELECT c.empresa_id id FROM medios_contacto m JOIN contactos c ON c.id = m.contacto_id WHERE ${ES_PRUEBA_MEDIO}
  UNION SELECT m.empresa_id id FROM medios_contacto m WHERE m.empresa_id IS NOT NULL AND ${ES_PRUEBA_MEDIO}`);

console.log(`Empresas reconocidas como de prueba (${candidatas.length}): ${candidatas.join(", ") || "ninguna"}`);
if (!pedidas.length) {
  console.log("Para ver qué se borraría, pasa --empresas=<ids> (por ejemplo, las de la lista de arriba que de verdad sean de prueba).");
  await db.end();
  process.exit(0);
}
const ajenas = pedidas.filter((id) => !candidatas.includes(id));
if (ajenas.length) {
  console.error(`Estas empresas NO parecen de prueba y no se tocan: ${ajenas.join(", ")}. Quítalas de --empresas. No se borró nada.`);
  await db.end();
  process.exit(1);
}

// --- Todo lo que cuelga de esas empresas
const E = pedidas;
const C = await ids("SELECT id FROM contactos WHERE empresa_id IN (?)", en(E));
const P = await ids("SELECT id FROM prospectos WHERE contacto_id IN (?)", en(C));
const O = await ids("SELECT id FROM oportunidades WHERE empresa_id IN (?) OR contacto_id IN (?) OR prospecto_id IN (?)", [...en(E), ...en(C), ...en(P)]);
const Q = await ids("SELECT id FROM cotizaciones WHERE empresa_id IN (?) OR oportunidad_id IN (?) OR contacto_id IN (?)", [...en(E), ...en(O), ...en(C)]);
const D = await ids("SELECT id FROM documentos WHERE empresa_id IN (?) OR oportunidad_id IN (?) OR contacto_id IN (?)", [...en(E), ...en(O), ...en(C)]);
const V = await ids("SELECT id FROM envios WHERE prospecto_id IN (?)", en(P));
const R = await ids("SELECT id FROM respuestas WHERE prospecto_id IN (?) OR envio_id IN (?)", [...en(P), ...en(V)]);
const T = await ids("SELECT id FROM tareas WHERE empresa_id IN (?) OR contacto_id IN (?) OR prospecto_id IN (?) OR respuesta_id IN (?) OR documento_id IN (?)", [...en(E), ...en(C), ...en(P), ...en(R), ...en(D)]);
const archivos = (await db.query("SELECT COUNT(*) n FROM documentos WHERE id IN (?) AND storage_driver = 'gcs'", en(D)))[0][0].n;

// Orden: primero lo que apunta a otras tablas, al final las empresas.
const PASOS = [
  ["notificaciones", "DELETE FROM notificaciones WHERE (entidad = 'tarea' AND entidad_id IN (?)) OR (entidad = 'documento' AND entidad_id IN (?)) OR (entidad = 'respuesta' AND entidad_id IN (?)) OR (entidad = 'empresa' AND entidad_id IN (?)) OR (entidad = 'prospecto' AND entidad_id IN (?)) OR (entidad = 'oportunidad' AND entidad_id IN (?)) OR (entidad = 'cotizacion' AND entidad_id IN (?))", [...en(T), ...en(D), ...en(R), ...en(E), ...en(P), ...en(O), ...en(Q)]],
  ["uso_ia", "DELETE FROM uso_ia WHERE empresa_id IN (?) OR respuesta_id IN (?)", [...en(E), ...en(R)]],
  ["correos_respuesta", "DELETE FROM correos_respuesta WHERE respuesta_id IN (?) OR prospecto_id IN (?)", [...en(R), ...en(P)]],
  ["tareas", "DELETE FROM tareas WHERE id IN (?)", en(T)],
  ["cotizacion_partidas", "DELETE FROM cotizacion_partidas WHERE cotizacion_id IN (?)", en(Q)],
  ["cotizaciones (versiones)", "UPDATE cotizaciones SET cotizacion_raiz_id = NULL WHERE id IN (?)", en(Q)],
  ["cotizaciones", "DELETE FROM cotizaciones WHERE id IN (?)", en(Q)],
  ["documentos (versiones)", "UPDATE documentos SET documento_raiz_id = NULL WHERE id IN (?)", en(D)],
  ["documentos", "DELETE FROM documentos WHERE id IN (?)", en(D)],
  ["historial_etapa_oportunidad", "DELETE FROM historial_etapa_oportunidad WHERE oportunidad_id IN (?)", en(O)],
  ["actividades", "DELETE FROM actividades WHERE empresa_id IN (?) OR contacto_id IN (?) OR oportunidad_id IN (?)", [...en(E), ...en(C), ...en(O)]],
  ["oportunidades", "DELETE FROM oportunidades WHERE id IN (?)", en(O)],
  ["respuestas", "DELETE FROM respuestas WHERE id IN (?)", en(R)],
  ["envios", "DELETE FROM envios WHERE id IN (?)", en(V)],
  ["resultados_scoring", "DELETE FROM resultados_scoring WHERE prospecto_id IN (?)", en(P)],
  ["incidencias", "DELETE FROM incidencias WHERE prospecto_id IN (?)", en(P)],
  ["borradores_captura", "DELETE FROM borradores_captura WHERE empresa_id IN (?) OR match_contacto_id IN (?) OR prospecto_id IN (?)", [...en(E), ...en(C), ...en(P)]],
  ["prospectos", "DELETE FROM prospectos WHERE id IN (?)", en(P)],
  ["medios_contacto", "DELETE FROM medios_contacto WHERE empresa_id IN (?) OR contacto_id IN (?)", [...en(E), ...en(C)]],
  ["contactos", "DELETE FROM contactos WHERE id IN (?)", en(C)],
  ["empresas", "DELETE FROM empresas WHERE id IN (?)", en(E)]
];

// Cuántas filas tocaría cada paso: se calcula con el mismo WHERE.
const cuantas = {};
for (const [tabla, sql, params] of PASOS) {
  const conteo = sql.replace(/^DELETE FROM (\w+)/, "SELECT COUNT(*) n FROM $1").replace(/^UPDATE (\w+) SET [^W]+/, "SELECT COUNT(*) n FROM $1 ");
  cuantas[tabla] = Number((await db.query(conteo, params))[0][0].n);
}
console.log(`\n${borrar ? "Se borrará" : "Se borraría"} (empresas ${E.join(", ")}):`);
for (const [tabla] of PASOS) if (!tabla.includes("(versiones)")) console.log(`  ${tabla.padEnd(28)} ${cuantas[tabla]}`);
console.log(`  (archivos en Google Cloud Storage que quedarían sin registro: ${archivos}; se pueden borrar del bucket aparte)`);
console.log("  No se tocan: lista_supresion, auditoria, campañas, usuarios ni catálogos.");

if (!borrar) {
  console.log("\nSolo se mostró. Para borrar: --borrar y LIMPIEZA_CONFIRMO=borrar-datos-de-prueba.");
  await db.end();
  process.exit(0);
}

await db.beginTransaction();
const hechas = {};
try {
  for (const [tabla, sql, params] of PASOS) hechas[tabla] = (await db.query(sql, params))[0].affectedRows;
  await db.commit();
} catch (error) {
  await db.rollback();
  console.error(`\nFalló en medio y se deshizo todo; no se borró nada. Error: ${error.code ?? ""} ${error.message}`);
  await db.end();
  process.exit(1);
}
await db.end();

const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });
const cuando = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
const carpeta = join(AQUI, "auditorias");
mkdirSync(carpeta, { recursive: true });
let archivo = join(carpeta, `limpieza-${hoy}.md`);
for (let n = 2; existsSync(archivo); n++) archivo = join(carpeta, `limpieza-${hoy}-${n}.md`);
writeFileSync(
  archivo,
  `# Limpieza de datos de prueba · ${hoy}

Hecha el ${cuando} con \`limpiar-datos-prueba.mjs\` sobre la base \`${url.pathname.slice(1)}\`. Sin datos personales.

- Empresas borradas: ${E.join(", ")}.
- Archivos de documentos que quedaron en Google Cloud Storage sin registro: ${archivos}.
- No se tocaron: lista de supresión, bitácora de auditoría, campañas, usuarios ni catálogos.

| Tabla | Filas borradas |
|---|---|
${PASOS.filter(([t]) => !t.includes("(versiones)")).map(([t]) => `| \`${t}\` | ${hechas[t]} |`).join("\n")}

Siguiente paso: correr la auditoría (\`auditar-datos.mjs\`) y comprobar que §6 «Datos de prueba» quedó en cero.
`
);
console.log(`\nListo. Registro: ${archivo}`);
