// Números del reporte de la prospección (OB-06; el piloto se convirtió en operación real el 9-nov-2026). Solo LEE la base y escribe un reporte
// con fecha en docs/documentacion/piloto/. Sin datos personales: cantidades e IDs.
//
//   PILOTO_DB_URL="mysql://usuario:contraseña@host:3306/base" node docs/documentacion/reporte-piloto.mjs
//   Opciones: --desde=AAAA-MM-DD --hasta=AAAA-MM-DD (días de México, incluidos; por omisión del 9-nov-2026,
//   primer día de envíos reales, a hoy) y --campana=<id>.
//
// Contra producción: autorizar la IP y leer DATABASE_URL como en RUNBOOK §6, y
// revocar al terminar. Qué significa cada número: REPORTE_DEL_PILOTO.md.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(AQUI, "..", "..", "package.json"));
const mysql = require("mysql2/promise");

const arg = (nombre, omision) => process.argv.find((a) => a.startsWith(`--${nombre}=`))?.split("=")[1] ?? omision;
const desde = arg("desde", "2026-11-09");
const hasta = arg("hasta", new Date().toLocaleDateString("sv-SE", { timeZone: "America/Mexico_City" }));
const campana = arg("campana", null);
if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta) || (campana && !/^\d+$/.test(campana))) {
  console.error("Uso: --desde=AAAA-MM-DD --hasta=AAAA-MM-DD [--campana=<id>]");
  process.exit(1);
}

const url = new URL(process.env.PILOTO_DB_URL ?? "");
const db = await mysql.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  ssl: url.hostname === "127.0.0.1" || url.hostname === "localhost" ? undefined : { rejectUnauthorized: false }
});
const uno = async (sql, params) => Number(Object.values((await db.query(sql, params))[0][0])[0] ?? 0);
const filas = async (sql, params) => (await db.query(sql, params))[0];

// La base guarda UTC; México está en UTC-6 todo el año desde 2022.
const MX = "CONVERT_TZ(%s, '+00:00', '-06:00')";
const dia = (col) => `DATE_FORMAT(${MX.replace("%s", col)}, '%Y-%m-%d')`;
const ini = `${desde} 06:00:00`;
const finFecha = new Date(`${hasta}T00:00:00Z`);
finFecha.setUTCDate(finFecha.getUTCDate() + 1);
const fin = `${finFecha.toISOString().slice(0, 10)} 06:00:00`;
const PERIODO = [ini, fin];
const filtroCampana = campana ? `AND p.campana_id = ${Number(campana)}` : "";

// Correos de prospección del periodo (cualquier estado) y sus prospectos.
const ENVIOS = `FROM envios v JOIN prospectos p ON p.id = v.prospecto_id WHERE v.canal = 'correo' AND v.enviado_en >= ? AND v.enviado_en < ? ${filtroCampana}`;
const PROSPECTOS_DEL_PILOTO = `SELECT DISTINCT v.prospecto_id ${ENVIOS} AND v.estado <> 'fallido'`;
const CLASES = ["interesado", "no_interesado", "baja", "reagendar", "automatica", "ambigua", "invalido"];
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)} %` : "—");
const mediana = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const casos = (n) => `${n} caso${n === 1 ? "" : "s"}`;
const horas = (h) => (h === null ? "—" : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} días`);
const tabla = (enc, rs) => (rs.length ? [`| ${enc.join(" | ")} |`, `|${enc.map(() => "---").join("|")}|`, ...rs.map((x) => `| ${x.join(" | ")} |`)].join("\n") : "Sin casos.");

const r = {};

// --- 1. Envíos
r.porDia = await filas(`SELECT ${dia("v.enviado_en")} d, v.numero_contacto n, v.estado, COUNT(*) c ${ENVIOS} GROUP BY d, n, v.estado ORDER BY d, n`, PERIODO);
r.personas = await uno(`SELECT COUNT(DISTINCT p.contacto_id) ${ENVIOS} AND v.estado <> 'fallido'`, PERIODO);
r.enviados = await uno(`SELECT COUNT(*) ${ENVIOS} AND v.estado = 'enviado'`, PERIODO);
r.sinConfirmar = await uno(`SELECT COUNT(*) ${ENVIOS} AND v.estado = 'registrado'`, PERIODO);
r.fallidos = await uno(`SELECT COUNT(*) ${ENVIOS} AND v.estado = 'fallido'`, PERIODO);
// Controles que deben dar 0.
// Por persona y campaña (desde el 9-nov-2026 la misma persona puede recibir la serie de dos campañas).
r.masDeTres = await filas(`SELECT p.contacto_id, p.campana_id, COUNT(*) n FROM envios v JOIN prospectos p ON p.id = v.prospecto_id
  WHERE v.canal = 'correo' AND v.estado <> 'fallido' AND v.enviado_en >= NOW() - INTERVAL 6 MONTH GROUP BY p.contacto_id, p.campana_id HAVING n > 3`);
// Personas que recibieron dos series a la vez (no debería pasar: una serie a la vez).
r.dosSeriesALaVez = await filas(`SELECT p1.contacto_id, COUNT(DISTINCT p1.campana_id) campanas FROM envios v1 JOIN prospectos p1 ON p1.id = v1.prospecto_id
  JOIN envios v2 ON v2.id <> v1.id JOIN prospectos p2 ON p2.id = v2.prospecto_id
  WHERE p2.contacto_id = p1.contacto_id AND NOT (p2.campana_id <=> p1.campana_id) AND v1.numero_contacto = 1 AND v2.numero_contacto = 1
    AND v1.estado <> 'fallido' AND v2.estado <> 'fallido' AND v1.enviado_en >= ? AND v1.enviado_en < ?
    AND v2.enviado_en BETWEEN v1.enviado_en - INTERVAL 7 DAY AND v1.enviado_en + INTERVAL 7 DAY
  GROUP BY p1.contacto_id`, PERIODO);
r.aSuprimidos = await filas(`SELECT v.id ${ENVIOS} AND v.estado <> 'fallido' AND EXISTS (SELECT 1 FROM lista_supresion s
  WHERE s.tipo = 'correo' AND s.valor_normalizado = LOWER(TRIM(v.destinatario)) AND s.creado_en < v.enviado_en)`, PERIODO);

// Desglose por campaña.
r.porCampana = await filas(`SELECT COALESCE(cp.nombre, 'sin campaña') campana, COUNT(*) correos, COUNT(DISTINCT p.contacto_id) personas,
    COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM respuestas rr WHERE rr.prospecto_id = p.id AND (rr.clasificacion IS NULL OR rr.clasificacion <> 'automatica')) THEN p.contacto_id END) respondieron,
    COUNT(DISTINCT CASE WHEN p.estado = 'interesado' THEN p.contacto_id END) interesadas
  FROM envios v JOIN prospectos p ON p.id = v.prospecto_id LEFT JOIN campanas cp ON cp.id = p.campana_id
  WHERE v.canal = 'correo' AND v.estado <> 'fallido' AND v.enviado_en >= ? AND v.enviado_en < ? ${filtroCampana}
  GROUP BY campana ORDER BY correos DESC`, PERIODO);

// --- 2. Respuestas de las personas del piloto (recibidas desde el inicio, aunque sea después del periodo)
const RESP = `FROM respuestas r JOIN prospectos p ON p.id = r.prospecto_id WHERE r.prospecto_id IN (${PROSPECTOS_DEL_PILOTO}) AND r.recibido_en >= ?`;
const RESP_P = [...PERIODO, ini];
r.respuestas = await filas(`SELECT COALESCE(r.clasificacion, 'sin clasificar') c, COUNT(*) n, SUM(r.tardia) tardias ${RESP} GROUP BY c`, RESP_P);
r.totalRespuestas = r.respuestas.reduce((s, x) => s + Number(x.n), 0);
// Quien respondió algo que no fue respuesta automática (fuera de oficina).
r.respondieron = await uno(`SELECT COUNT(DISTINCT p.contacto_id) ${RESP} AND (r.clasificacion IS NULL OR r.clasificacion <> 'automatica')`, RESP_P);
r.interesados = await uno(`SELECT COUNT(DISTINCT p.contacto_id) ${RESP} AND r.clasificacion = 'interesado'`, RESP_P);
r.tiemposClasificar = (await filas(`SELECT TIMESTAMPDIFF(MINUTE, r.recibido_en, r.clasificado_en) / 60 h ${RESP} AND r.clasificado_en IS NOT NULL`, RESP_P)).map((x) => Number(x.h));

// --- 3. Bajas, rebotes y quejas (lista de supresión desde el inicio del periodo)
r.supresion = await filas(`SELECT COALESCE(evento, motivo, 'sin motivo') e, tipo, COUNT(*) n FROM lista_supresion WHERE creado_en >= ? GROUP BY e, tipo ORDER BY n DESC`, [ini]);
const cuenta = (ev) => r.supresion.filter((x) => x.e === ev && x.tipo === "correo").reduce((s, x) => s + Number(x.n), 0);
r.rebotes = cuenta("bounce");
r.quejas = cuenta("spamreport");
r.freno = await filas(`SELECT accion, DATE_FORMAT(${MX.replace("%s", "creado_en")}, '%Y-%m-%d %H:%i') cuando FROM auditoria WHERE entidad = 'freno_dominio' AND creado_en >= ? ORDER BY creado_en`, [ini]);

// --- 4. Interesados: la tarea «Contactar prospecto interesado»
const TAREAS_INT = "FROM tareas WHERE titulo = 'Contactar prospecto interesado' AND creado_en >= ?";
r.tareasInt = await filas(`SELECT estado, COUNT(*) n, SUM(escalado_en IS NOT NULL) escaladas ${TAREAS_INT} GROUP BY estado`, [ini]);
r.tiemposAtender = (await filas(`SELECT TIMESTAMPDIFF(MINUTE, creado_en, cerrada_en) / 60 h ${TAREAS_INT} AND estado = 'cerrada' AND cerrada_en IS NOT NULL`, [ini])).map((x) => Number(x.h));

// --- 5. Fallas
r.incidencias = await filas("SELECT tipo, severidad, COUNT(*) n, SUM(estado = 'abierta') abiertas FROM incidencias WHERE creado_en >= ? AND creado_en < ? GROUP BY tipo, severidad ORDER BY n DESC", PERIODO);
r.procesos = await filas("SELECT COALESCE(workflow, tipo, '—') w, COUNT(*) n, SUM(estado <> 'resuelto') abiertos FROM procesos_fallidos WHERE creado_en >= ? AND creado_en < ? GROUP BY w ORDER BY n DESC", PERIODO);

// --- 6. El modelo (EVALUACION_DEL_MODELO.md §4)
r.m1 = await filas(`SELECT r.clasificacion_sugerida s, r.clasificacion f, COUNT(*) n ${RESP} AND r.clasificacion IS NOT NULL AND r.clasificacion_sugerida IS NOT NULL GROUP BY s, f`, RESP_P);
r.m1Total = r.m1.reduce((s, x) => s + Number(x.n), 0);
r.m1Acuerdo = r.m1.filter((x) => x.s === x.f).reduce((s, x) => s + Number(x.n), 0);
r.m2 = await filas(`SELECT r.id, r.clasificacion_sugerida s ${RESP} AND r.clasificacion = 'baja' AND (r.clasificacion_sugerida IS NULL OR r.clasificacion_sugerida <> 'baja')`, RESP_P);
r.m3 = await filas(`SELECT COALESCE(p.prioridad, 'sin prioridad') pr, COUNT(DISTINCT p.contacto_id) personas,
    COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM respuestas r WHERE r.prospecto_id = p.id AND (r.clasificacion IS NULL OR r.clasificacion <> 'automatica')) THEN p.contacto_id END) respondieron,
    COUNT(DISTINCT CASE WHEN EXISTS (SELECT 1 FROM respuestas r WHERE r.prospecto_id = p.id AND r.clasificacion = 'interesado') THEN p.contacto_id END) interesados
  FROM prospectos p WHERE p.id IN (${PROSPECTOS_DEL_PILOTO}) GROUP BY pr ORDER BY FIELD(pr, 'alta', 'media', 'baja', 'sin prioridad')`, PERIODO);
r.m4 = await filas(`SELECT metodo, COUNT(*) n FROM resultados_scoring WHERE creado_en >= ? AND creado_en < ? GROUP BY metodo`, PERIODO);
r.m4Agotado = await uno("SELECT COUNT(*) FROM incidencias WHERE tipo = 'gemini_agotado' AND creado_en >= ? AND creado_en < ?", PERIODO);
r.m5 = await filas("SELECT uso_ia, estado, COUNT(*) n FROM correos_respuesta WHERE creado_en >= ? GROUP BY uso_ia, estado", [ini]);
r.migracion = (await filas("SELECT MAX(version) v FROM schema_migrations"))[0].v;
await db.end();

// --- Reporte
const dias = [...new Set(r.porDia.map((x) => x.d))];
const celda = (d, n, estado) => r.porDia.filter((x) => x.d === d && Number(x.n) === n && (!estado || x.estado === estado)).reduce((s, x) => s + Number(x.c), 0);
const filasDia = dias.map((d) => [d, String(celda(d, 1)), String(celda(d, 2)), String(celda(d, 3)), String(celda(d, 1, "fallido") + celda(d, 2, "fallido") + celda(d, 3, "fallido"))]);
const totalCorreos = r.enviados + r.sinConfirmar;
const cuando = new Date().toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "long", timeStyle: "short" });
const tareasTotal = r.tareasInt.reduce((s, x) => s + Number(x.n), 0);
const tareasDe = (e) => Number(r.tareasInt.find((x) => x.estado === e)?.n ?? 0);
const escaladas = r.tareasInt.reduce((s, x) => s + Number(x.escaladas ?? 0), 0);
const m4Total = r.m4.reduce((s, x) => s + Number(x.n), 0);
const m4Reglas = Number(r.m4.find((x) => x.metodo === "reglas")?.n ?? 0);
const clases = (lista) => CLASES.map((c) => [c, Number(lista.find((x) => x.c === c)?.n ?? 0)]).filter(([, n]) => n > 0);

const md = `# Números de la prospección · ${desde} al ${hasta}

Generado el ${cuando} con \`reporte-piloto.mjs\` sobre la base \`${url.pathname.slice(1)}\` (migración \`${r.migracion}\`)${campana ? `, solo la campaña ${campana}` : ""}.
Solo lectura. Sin datos personales. Días en hora de México. Qué significa cada número: [REPORTE_DEL_PILOTO.md](../REPORTE_DEL_PILOTO.md).

## 1. Envíos

| Día | Correo 1 | Correo 2 | Correo 3 | Fallidos (no gastan el contacto) |
|---|---|---|---|---|
${filasDia.map((x) => `| ${x.join(" | ")} |`).join("\n") || "| — | 0 | 0 | 0 | 0 |"}

- Correos que salieron: **${totalCorreos}** (${r.enviados} confirmados por SendGrid y ${r.sinConfirmar} sin confirmar), a **${r.personas}** personas. Fallidos: ${r.fallidos}.
- Personas con más de 3 correos en 6 meses en una misma campaña: **${r.masDeTres.length}** (debe ser 0)${r.masDeTres.length ? `: contactos ${r.masDeTres.map((x) => `${x.contacto_id} (campaña ${x.campana_id ?? "sin campaña"})`).join(", ")}` : ""}.
- Personas a las que les empezaron dos campañas con menos de una semana de diferencia: **${r.dosSeriesALaVez.length}** (debe ser 0: una serie a la vez)${r.dosSeriesALaVez.length ? `: contactos ${r.dosSeriesALaVez.map((x) => x.contacto_id).join(", ")}` : ""}.

${tabla(["Campaña", "Correos", "Personas", "Respondieron", "Interesadas"], r.porCampana.map((x) => [x.campana, String(x.correos), String(x.personas), `${x.respondieron} (${pct(Number(x.respondieron), Number(x.personas))})`, `${x.interesadas} (${pct(Number(x.interesadas), Number(x.personas))})`]))}
- Correos a una dirección que ya estaba suprimida: **${r.aSuprimidos.length}** (debe ser 0)${r.aSuprimidos.length ? `: envíos ${r.aSuprimidos.map((x) => x.id).join(", ")}` : ""}.

## 2. Respuestas

De las personas que recibieron correo en el periodo, recibidas desde el ${desde} hasta hoy.

${tabla(["Clasificación", "Respuestas"], [...clases(r.respuestas).map(([c, n]) => [c, String(n)]), ...(r.respuestas.find((x) => x.c === "sin clasificar") ? [["sin clasificar todavía", String(r.respuestas.find((x) => x.c === "sin clasificar").n)]] : [])])}

- Respuestas: **${r.totalRespuestas}** (tardías: ${r.respuestas.reduce((s, x) => s + Number(x.tardias ?? 0), 0)}).
- Personas que respondieron (sin contar respuestas automáticas): **${r.respondieron}** de ${r.personas} (**${pct(r.respondieron, r.personas)}**).
- Personas interesadas: **${r.interesados}** de ${r.personas} (**${pct(r.interesados, r.personas)}**).
- Tiempo de la respuesta a su clasificación (mediana, ${casos(r.tiemposClasificar.length)}): ${horas(mediana(r.tiemposClasificar))}.

## 3. Bajas, rebotes y quejas

${tabla(["Motivo", "Medio", "Altas en la lista de supresión"], r.supresion.map((x) => [x.e, x.tipo, String(x.n)]))}

- Rebotes: **${r.rebotes}** de ${totalCorreos} correos (**${pct(r.rebotes, totalCorreos)}**; para subir el tope tiene que quedar debajo de 2 %).
- Quejas de spam: **${r.quejas}** (**${pct(r.quejas, totalCorreos)}**; debajo de 0.1 %).
- Freno del dominio: ${r.freno.length ? r.freno.map((x) => `${x.accion} el ${x.cuando}`).join("; ") : "no se activó"}.

## 4. Interesados

- Tareas «Contactar prospecto interesado» creadas: **${tareasTotal}**; cerradas ${tareasDe("cerrada")}, pendientes ${tareasDe("pendiente") + tareasDe("en_progreso")}, canceladas ${tareasDe("cancelada")}.
- Escaladas por llevar un día hábil sin atender: **${escaladas}**.
- Tiempo de la tarea a su cierre (mediana, ${casos(r.tiemposAtender.length)}): ${horas(mediana(r.tiemposAtender))}.

## 5. Fallas

${tabla(["Incidencia", "Severidad", "Casos", "Abiertas"], r.incidencias.map((x) => [x.tipo, x.severidad, String(x.n), String(x.abiertas)]))}

${tabla(["Proceso fallido (flujo)", "Casos", "Sin resolver"], r.procesos.map((x) => [x.w, String(x.n), String(x.abiertos)]))}

## 6. El modelo

**M1 · Acuerdo IA-persona:** ${r.m1Acuerdo} de ${r.m1Total} (**${pct(r.m1Acuerdo, r.m1Total)}**).

${tabla(["Sugirió la IA", "Decidió la persona", "Casos"], r.m1.map((x) => [x.s, x.f, String(x.n)]))}

**M2 · Bajas que la IA no vio:** **${r.m2.length}**${r.m2.length ? ` (respuestas ${r.m2.map((x) => `${x.id}, sugerida ${x.s ?? "sin sugerencia"}`).join("; ")})` : ""}.

**M3 · ¿La prioridad predice la respuesta?**

${tabla(["Prioridad", "Personas", "Respondieron", "Tasa", "Interesadas", "Tasa"], r.m3.map((x) => [x.pr, String(x.personas), String(x.respondieron), pct(Number(x.respondieron), Number(x.personas)), String(x.interesados), pct(Number(x.interesados), Number(x.personas))]))}

**M4 · Disponibilidad:** scores del periodo calculados solo por reglas: ${m4Reglas} de ${m4Total} (**${pct(m4Reglas, m4Total)}**); incidencias \`gemini_agotado\`: ${r.m4Agotado}.

**M5 · Uso del borrador:**

${tabla(["Uso de la IA", "Estado", "Correos desde el CRM"], r.m5.map((x) => [x.uso_ia, x.estado, String(x.n)]))}

Con pocos casos estos porcentajes no alcanzan para concluir: reportar siempre el número de casos junto al porcentaje.
`;

const carpeta = join(AQUI, "piloto");
mkdirSync(carpeta, { recursive: true });
let archivo = join(carpeta, `numeros-${hasta}.md`);
for (let n = 2; existsSync(archivo); n++) archivo = join(carpeta, `numeros-${hasta}-${n}.md`);
writeFileSync(archivo, md);
console.log(`Reporte: ${archivo}`);
console.log(`Correos ${totalCorreos} a ${r.personas} personas · respondieron ${r.respondieron} · interesadas ${r.interesados} · rebotes ${r.rebotes} · quejas ${r.quejas} · >3 correos ${r.masDeTres.length} · dos series ${r.dosSeriesALaVez.length} · a suprimidos ${r.aSuprimidos.length}`);
