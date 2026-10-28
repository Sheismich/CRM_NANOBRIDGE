// Auditoría de calidad de datos (T1). Solo LEE la base y escribe un reporte con
// fecha en docs/documentacion/auditorias/. No incluye datos personales: solo
// cantidades e IDs (para buscarlos en el CRM: /empresas/<id>, etc.).
//
//   AUDITORIA_DB_URL="mysql://usuario:contraseña@host:3306/base" node docs/documentacion/auditar-datos.mjs
//
// Contra producción: autorizar la IP y leer DATABASE_URL como en RUNBOOK §6, y
// revocar al terminar. Reglas en DICCIONARIO_DE_DATOS.md (§3-§6).
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(AQUI, "..", "..", "package.json"));
const mysql = require("mysql2/promise");

const url = new URL(process.env.AUDITORIA_DB_URL ?? "");
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: url.hostname === "127.0.0.1" || url.hostname === "localhost" ? undefined : { rejectUnauthorized: false }
});
const uno = async (sql) => Number(Object.values((await db.query(sql))[0][0])[0]);
const filas = async (sql) => (await db.query(sql))[0];
const ids = (lista, max = 15) => (lista.length ? lista.slice(0, max).join(", ") + (lista.length > max ? ` y ${lista.length - max} más` : "") : "—");

const ESTADOS_VALIDOS = ["capturado", "en_fila", "validado", "excluido", "interesado", "no_interesado", "en_revision", "descartado", "inactivo", "baja"];
const CERRADOS = ["baja", "interesado", "no_interesado", "descartado", "excluido", "inactivo"];
const lista = (xs) => xs.map((x) => `'${x}'`).join(",");
// Nombre de empresa para comparar: minúsculas, sin puntuación ni la forma jurídica.
const NOMBRE_EMPRESA = `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(nombre_legal), '[[:punct:]]', ''), '\\\\s+(sa|sapi|s de rl|sc|sas)?\\\\s*(de\\\\s+cv)?\\\\s*$', ''))`;
const CORREO_VALIDO = `'^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'`;
// Datos de prueba: dominios .test/.local, buzones +prueba y empresas con "prueba" en el nombre.
const ES_PRUEBA_MEDIO = `(valor_normalizado LIKE '%.test' OR valor_normalizado LIKE '%.local' OR valor_normalizado LIKE '%+prueba%' OR valor_normalizado LIKE '%@pruebas-nanobridge%')`;

const r = {};
// --- Totales
r.totales = {};
for (const t of ["empresas", "contactos", "medios_contacto", "prospectos", "borradores_captura", "envios", "respuestas", "lista_supresion", "oportunidades", "cotizaciones", "documentos", "tareas", "auditoria"]) r.totales[t] = await uno(`SELECT COUNT(*) FROM ${t}`);
r.empresasActivas = await uno("SELECT COUNT(*) FROM empresas WHERE activo = 1");
r.contactosActivos = await uno("SELECT COUNT(*) FROM contactos c JOIN empresas e ON e.id = c.empresa_id WHERE c.activo = 1 AND e.activo = 1");

// --- Completitud de empresas (activas)
r.emp = {
  sinGiro: (await filas("SELECT id FROM empresas WHERE activo = 1 AND (giro IS NULL OR TRIM(giro) = '') ORDER BY id")).map((f) => f.id),
  sinTamano: (await filas("SELECT id FROM empresas WHERE activo = 1 AND tamano IS NULL ORDER BY id")).map((f) => f.id),
  sinUbicacion: await uno("SELECT COUNT(*) FROM empresas WHERE activo = 1 AND (estado IS NULL OR TRIM(estado) = '') AND (ciudad IS NULL OR TRIM(ciudad) = '')"),
  sinResponsable: await uno("SELECT COUNT(*) FROM empresas WHERE activo = 1 AND propietario_id IS NULL"),
  paisInvalido: await uno("SELECT COUNT(*) FROM empresas WHERE pais NOT REGEXP '^[A-Z]{2}$'")
};
// La base compara sin distinguir mayúsculas ni acentos (utf8mb4_0900_ai_ci): para
// ver las formas distintas con que se escribió un giro hay que comparar en binario.
r.giros = await filas("SELECT LOWER(TRIM(giro)) g, COUNT(DISTINCT giro COLLATE utf8mb4_bin) variantes, GROUP_CONCAT(DISTINCT giro COLLATE utf8mb4_bin ORDER BY giro SEPARATOR ' / ') formas, COUNT(*) n FROM empresas WHERE activo = 1 AND giro IS NOT NULL AND TRIM(giro) <> '' GROUP BY LOWER(TRIM(giro)) ORDER BY n DESC");

// --- Duplicados posibles de empresas (no hay regla en la base: punto señalado 1)
r.empresasDuplicadas = await filas(`SELECT ${NOMBRE_EMPRESA} nombre, GROUP_CONCAT(id ORDER BY id) ids, COUNT(*) n FROM empresas WHERE activo = 1 GROUP BY nombre HAVING n > 1 ORDER BY n DESC`);

// --- Contactos
r.con = {
  sinMedioActivo: (await filas("SELECT c.id FROM contactos c JOIN empresas e ON e.id = c.empresa_id WHERE c.activo = 1 AND e.activo = 1 AND NOT EXISTS (SELECT 1 FROM medios_contacto m WHERE m.contacto_id = c.id AND m.estado_contacto = 'activo' AND m.tipo IN ('correo','telefono','whatsapp')) ORDER BY c.id")).map((f) => f.id),
  sinCorreoActivo: await uno("SELECT COUNT(*) FROM contactos c JOIN empresas e ON e.id = c.empresa_id WHERE c.activo = 1 AND e.activo = 1 AND NOT EXISTS (SELECT 1 FROM medios_contacto m WHERE m.contacto_id = c.id AND m.tipo = 'correo' AND m.estado_contacto = 'activo')"),
  mismoNombreMismaEmpresa: await filas("SELECT empresa_id, GROUP_CONCAT(id ORDER BY id) ids, COUNT(*) n FROM contactos WHERE activo = 1 GROUP BY empresa_id, LOWER(TRIM(nombre)) HAVING n > 1")
};

// --- Medios de contacto
r.med = {
  porTipoEstado: await filas("SELECT tipo, estado_contacto, COUNT(*) n FROM medios_contacto GROUP BY tipo, estado_contacto ORDER BY tipo, estado_contacto"),
  correoMalFormado: (await filas(`SELECT id FROM medios_contacto WHERE tipo = 'correo' AND valor_normalizado NOT REGEXP ${CORREO_VALIDO}`)).map((f) => f.id),
  correoMalNormalizado: (await filas("SELECT id FROM medios_contacto WHERE tipo = 'correo' AND valor_normalizado <> LOWER(TRIM(valor))")).map((f) => f.id),
  telefonoMalNormalizado: (await filas("SELECT id FROM medios_contacto WHERE tipo IN ('telefono','whatsapp') AND valor_normalizado <> REGEXP_REPLACE(valor, '[^0-9]', '')")).map((f) => f.id),
  telefonoLargoRaro: (await filas("SELECT id FROM medios_contacto WHERE tipo IN ('telefono','whatsapp') AND (CHAR_LENGTH(valor_normalizado) < 7 OR CHAR_LENGTH(valor_normalizado) > 15)")).map((f) => f.id),
  activoPeroSuprimido: (await filas("SELECT m.id FROM medios_contacto m JOIN lista_supresion s ON s.valor_normalizado = m.valor_normalizado AND (s.tipo = m.tipo OR (s.tipo = 'telefono' AND m.tipo = 'whatsapp')) WHERE m.estado_contacto = 'activo'")).map((f) => f.id),
  // Mismos últimos 10 dígitos con distinto valor (ej. 4421234567 y 524421234567).
  telefonoMismoNumero: await filas("SELECT RIGHT(valor_normalizado, 10) n10, GROUP_CONCAT(id ORDER BY id) ids, COUNT(DISTINCT valor_normalizado) n FROM medios_contacto WHERE tipo IN ('telefono','whatsapp') AND CHAR_LENGTH(valor_normalizado) >= 10 GROUP BY n10 HAVING n > 1"),
  // Gmail ignora los puntos y lo que va después de "+": mismo buzón con distinto valor.
  gmailMismoBuzon: await filas("SELECT CONCAT(REPLACE(SUBSTRING_INDEX(SUBSTRING_INDEX(valor_normalizado, '@', 1), '+', 1), '.', ''), '@gmail.com') buzon, GROUP_CONCAT(id ORDER BY id) ids, COUNT(*) n FROM medios_contacto WHERE tipo = 'correo' AND valor_normalizado LIKE '%@gmail.com' GROUP BY buzon HAVING n > 1")
};

// --- Prospectos
r.pro = {
  porEstado: await filas("SELECT estado, COUNT(*) n FROM prospectos GROUP BY estado ORDER BY n DESC"),
  estadoInvalido: (await filas(`SELECT id FROM prospectos WHERE estado NOT IN (${lista(ESTADOS_VALIDOS)})`)).map((f) => f.id),
  variosAbiertosMismaPersona: await filas(`SELECT contacto_id, GROUP_CONCAT(id ORDER BY id) ids, COUNT(*) n FROM prospectos WHERE estado NOT IN (${lista(CERRADOS)}) GROUP BY contacto_id HAVING n > 1`),
  abiertoConContactoInactivo: (await filas(`SELECT p.id FROM prospectos p JOIN contactos c ON c.id = p.contacto_id JOIN empresas e ON e.id = c.empresa_id WHERE p.estado NOT IN (${lista(CERRADOS)}) AND (c.activo = 0 OR e.activo = 0)`)).map((f) => f.id),
  enCampanaSinCorreo: (await filas(`SELECT p.id FROM prospectos p WHERE p.estado IN ('validado','en_fila') AND NOT EXISTS (SELECT 1 FROM medios_contacto m WHERE m.contacto_id = p.contacto_id AND m.tipo = 'correo' AND m.estado_contacto = 'activo')`)).map((f) => f.id),
  enCampanaSinGiroTamano: (await filas("SELECT p.id FROM prospectos p JOIN contactos c ON c.id = p.contacto_id JOIN empresas e ON e.id = c.empresa_id WHERE p.estado IN ('validado','en_fila') AND (e.giro IS NULL OR TRIM(e.giro) = '' OR e.tamano IS NULL)")).map((f) => f.id)
};

// --- Envíos: máximo 3 por persona en 6 meses
r.masDeTresEnvios = await filas("SELECT p.contacto_id, COUNT(*) n FROM envios v JOIN prospectos p ON p.id = v.prospecto_id WHERE v.canal = 'correo' AND v.enviado_en >= NOW() - INTERVAL 6 MONTH GROUP BY p.contacto_id HAVING n > 3");

// --- Área de carga
r.borradores = {
  porEstado: await filas("SELECT estado, COUNT(*) n FROM borradores_captura GROUP BY estado ORDER BY n DESC"),
  duplicadosSinResolver: await uno("SELECT COUNT(*) FROM borradores_captura WHERE estado = 'duplicado' AND procesado_en IS NULL"),
  pendientesViejos: await uno("SELECT COUNT(*) FROM borradores_captura WHERE estado = 'pendiente_revision' AND creado_en < NOW() - INTERVAL 7 DAY")
};

// --- Datos de prueba (para limpiar antes del piloto)
r.prueba = {
  empresas: (await filas("SELECT id FROM empresas WHERE LOWER(nombre_legal) LIKE '%prueba%' OR LOWER(nombre_legal) IN ('no se','no se 2') ORDER BY id")).map((f) => f.id),
  medios: await uno(`SELECT COUNT(*) FROM medios_contacto WHERE ${ES_PRUEBA_MEDIO}`),
  empresasConMediosDePrueba: (await filas(`SELECT DISTINCT c.empresa_id id FROM medios_contacto m JOIN contactos c ON c.id = m.contacto_id WHERE ${ES_PRUEBA_MEDIO} ORDER BY id`)).map((f) => f.id)
};
r.migracion = (await filas("SELECT MAX(version) v FROM schema_migrations"))[0].v;
await db.end();

// --- KPI T1.1 y T1.2 (Programa §7; reglas del diccionario)
const empresasQueNoCumplen = new Set([...r.emp.sinGiro, ...r.emp.sinTamano]);
const contactosQueNoCumplen = new Set(r.con.sinMedioActivo);
const mediosQueNoCumplen = new Set([...r.med.correoMalFormado, ...r.med.correoMalNormalizado, ...r.med.telefonoMalNormalizado, ...r.med.telefonoLargoRaro, ...r.med.activoPeroSuprimido]);
const auditados = r.empresasActivas + r.contactosActivos + r.totales.medios_contacto + r.totales.prospectos;
const noCumplen = empresasQueNoCumplen.size + contactosQueNoCumplen.size + mediosQueNoCumplen.size + r.pro.estadoInvalido.length + r.pro.enCampanaSinCorreo.length;
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : "N/E");
const duplicadosNoResueltos = r.empresasDuplicadas.reduce((s, d) => s + d.n - 1, 0) + r.con.mismoNombreMismaEmpresa.reduce((s, d) => s + d.n - 1, 0) + r.med.telefonoMismoNumero.length + r.med.gmailMismoBuzon.length + r.pro.variosAbiertosMismaPersona.length + r.borradores.duplicadosSinResolver;

const hoy = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" });
const fecha = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
const tabla = (cab, rows) => [`| ${cab.join(" | ")} |`, `|${cab.map(() => "---").join("|")}|`, ...rows.map((x) => `| ${x.join(" | ")} |`)].join("\n");
const fila = (control, n, detalle) => [control, String(n), n ? detalle : "—"];

const md = `# Auditoría de calidad de datos · ${hoy}

Generada el ${fecha} con \`auditar-datos.mjs\` sobre la base \`${url.pathname.slice(1)}\` (migración \`${r.migracion}\`).
Solo lectura. Sin datos personales: los números son IDs del CRM. Reglas en \`DICCIONARIO_DE_DATOS.md\`.

## Resumen

| Indicador | Resultado |
|---|---|
| **T1.1 · Validez y completitud** (registros que cumplen las reglas / auditados) | **${pct(auditados - noCumplen, auditados)}** (${auditados - noCumplen} de ${auditados}) |
| **T1.2 · Control de duplicados** (1 − duplicados no resueltos / auditados) | **${pct(auditados - duplicadosNoResueltos, auditados)}** (${duplicadosNoResueltos} posibles duplicados sin resolver) |
| Empresas activas / contactos activos / medios / prospectos | ${r.empresasActivas} / ${r.contactosActivos} / ${r.totales.medios_contacto} / ${r.totales.prospectos} |

Auditados = empresas activas + contactos activos + medios de contacto + prospectos (población completa, no muestra).

## 1. Totales

${tabla(["Tabla", "Registros"], Object.entries(r.totales).map(([t, n]) => [`\`${t}\``, String(n)]))}

## 2. Completitud y validez

${tabla(["Control", "Casos", "IDs"], [
  fila("Empresas activas sin giro (la automatización no les escribe)", r.emp.sinGiro.length, `empresas ${ids(r.emp.sinGiro)}`),
  fila("Empresas activas sin tamaño (la automatización no les escribe)", r.emp.sinTamano.length, `empresas ${ids(r.emp.sinTamano)}`),
  fila("Empresas activas sin estado ni ciudad", r.emp.sinUbicacion, "ver Empresas, filtro de región"),
  fila("Empresas activas sin responsable", r.emp.sinResponsable, "Empresas → «Sin asignar»"),
  fila("País con formato inválido", r.emp.paisInvalido, "—"),
  fila("Contactos activos sin ningún medio activo (correo, teléfono o WhatsApp)", r.con.sinMedioActivo.length, `contactos ${ids(r.con.sinMedioActivo)}`),
  fila("Contactos activos sin correo activo (no entran a la automatización)", r.con.sinCorreoActivo, "Contactos → «Sin medio»"),
  fila("Correos con formato inválido", r.med.correoMalFormado.length, `medios ${ids(r.med.correoMalFormado)}`),
  fila("Correos mal normalizados", r.med.correoMalNormalizado.length, `medios ${ids(r.med.correoMalNormalizado)}`),
  fila("Teléfonos mal normalizados", r.med.telefonoMalNormalizado.length, `medios ${ids(r.med.telefonoMalNormalizado)}`),
  fila("Teléfonos con menos de 7 o más de 15 dígitos", r.med.telefonoLargoRaro.length, `medios ${ids(r.med.telefonoLargoRaro)}`),
  fila("Medios activos que están en la lista de supresión", r.med.activoPeroSuprimido.length, `medios ${ids(r.med.activoPeroSuprimido)} (no se les escribe: la lista manda)`),
  fila("Prospectos con estado fuera de la lista válida", r.pro.estadoInvalido.length, `prospectos ${ids(r.pro.estadoInvalido)}`),
  fila("Prospectos validados o en fila sin correo activo", r.pro.enCampanaSinCorreo.length, `prospectos ${ids(r.pro.enCampanaSinCorreo)}`),
  fila("Prospectos validados o en fila sin giro o tamaño", r.pro.enCampanaSinGiroTamano.length, `prospectos ${ids(r.pro.enCampanaSinGiroTamano)}`),
  fila("Prospectos abiertos con contacto o empresa desactivados", r.pro.abiertoConContactoInactivo.length, `prospectos ${ids(r.pro.abiertoConContactoInactivo)}`),
  fila("Personas con más de 3 correos en 6 meses (no debería pasar)", r.masDeTresEnvios.length, `contactos ${ids(r.masDeTresEnvios.map((x) => x.contacto_id))}`)
])}

### Giros escritos de varias formas

${r.giros.filter((g) => g.variantes > 1).length ? tabla(["Giro", "Formas distintas", "Empresas"], r.giros.filter((g) => g.variantes > 1).map((g) => [g.g, g.formas, String(g.n)])) : "Ninguno: cada giro se escribe de una sola forma."}

Giros en uso: ${r.giros.length} (${r.giros.map((g) => `${g.g} ${g.n}`).join(", ") || "—"}).

## 3. Duplicados

${tabla(["Control", "Grupos", "IDs por grupo"], [
  fila("Empresas activas con el mismo nombre (sin puntuación ni forma jurídica)", r.empresasDuplicadas.length, r.empresasDuplicadas.map((d) => `[${d.ids}]`).join(" ")),
  fila("Contactos con el mismo nombre en la misma empresa", r.con.mismoNombreMismaEmpresa.length, r.con.mismoNombreMismaEmpresa.map((d) => `[${d.ids}]`).join(" ")),
  fila("Mismo teléfono con distinto formato (últimos 10 dígitos)", r.med.telefonoMismoNumero.length, r.med.telefonoMismoNumero.map((d) => `[${d.ids}]`).join(" ")),
  fila("Mismo buzón de Gmail con puntos o «+»", r.med.gmailMismoBuzon.length, r.med.gmailMismoBuzon.map((d) => `[${d.ids}]`).join(" ")),
  fila("Personas con más de un prospecto abierto a la vez", r.pro.variosAbiertosMismaPersona.length, r.pro.variosAbiertosMismaPersona.map((d) => `contacto ${d.contacto_id}: [${d.ids}]`).join(" ")),
  fila("Filas importadas marcadas «duplicado» sin resolver", r.borradores.duplicadosSinResolver, "Prospectos → Importaciones")
])}

Medios repetidos exactos (mismo tipo y valor): **0 posibles**, la base no lo permite (\`uq_medio_tipo_valor\`).

## 4. Estado del embudo y del área de carga

${tabla(["Estado del prospecto", "Prospectos"], r.pro.porEstado.map((x) => [x.estado, String(x.n)]))}

${tabla(["Estado de la fila importada", "Filas"], r.borradores.porEstado.map((x) => [x.estado, String(x.n)]))}

Filas pendientes de revisar con más de 7 días: ${r.borradores.pendientesViejos} (expiran a los 30).

${tabla(["Medio", "Estado", "Cantidad"], r.med.porTipoEstado.map((x) => [x.tipo, x.estado_contacto, String(x.n)]))}

## 5. Datos de prueba (a limpiar antes del piloto)

- Empresas con «prueba» en el nombre o de prueba conocidas: **${r.prueba.empresas.length}** (${ids(r.prueba.empresas, 30)}).
- Medios de contacto de prueba (\`.test\`, \`.local\`, \`+prueba\`): **${r.prueba.medios}**, en las empresas ${ids(r.prueba.empresasConMediosDePrueba, 30)}.
`;

const carpeta = join(AQUI, "auditorias");
mkdirSync(carpeta, { recursive: true });
const archivo = join(carpeta, `calidad-${hoy}.md`);
writeFileSync(archivo, md);
console.log(`Reporte: ${archivo}`);
console.log(`T1.1 ${pct(auditados - noCumplen, auditados)} · T1.2 ${pct(auditados - duplicadosNoResueltos, auditados)} · auditados ${auditados}`);
