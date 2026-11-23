// Limpia exports de n8n para el repo público: deja solo lo necesario para
// reimportar, tapa correos y busca llaves. Ver README.md de esta carpeta.
//
// Uso: CORREOS_A_TAPAR=<archivo.json> node limpiar-n8n.mjs <dirEntrada> <dirSalida> <archivo>...
// CORREOS_A_TAPAR es un JSON LOCAL (nunca en el repo) que dice con qué
// marcador se cambia cada correo real: { "correo@real": "<CORREO_ADMIN_1>" }.
// Un correo que no esté ahí ni en PERMITIDOS sale como "<CORREO>".
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const [, , entrada, salida, ...archivos] = process.argv;
mkdirSync(salida, { recursive: true });

const CORREOS = process.env.CORREOS_A_TAPAR ? JSON.parse(readFileSync(process.env.CORREOS_A_TAPAR, "utf8")) : {};
const PERMITIDOS = new Set(["hola@contacto.nano-bridge-mex.com", "correo+etiqueta@x.com", "correo@x.com"]);
// Llave PÚBLICA del Event Webhook de SendGrid (PT3): no es secreta.
const LLAVE_PUBLICA_SENDGRID = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEg5aRNhh+DLFC74CeyxiF5lebBiWTtEJi90NBoTq6tXJ0Ef3C47UZPertiAyYXwbPhITVpmIFF+mjIVxYYoCmng==";
const SOSPECHOSOS = [
  [/SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g, "llave de SendGrid"],
  [/AIza[0-9A-Za-z_-]{30,}/g, "llave de Google"],
  [/Bearer\s+[A-Za-z0-9._-]{16,}/gi, "token Bearer"],
  [/"(x-api-key|authorization|password|apiKey|api_key|secret|token)"\s*:\s*"[^"{]{6,}"/gi, "valor de llave en un campo"],
  [/[A-Za-z0-9+/_-]{40,}={0,2}/g, "texto largo tipo llave"]
];

const reporte = [];
const tapar = (texto, avisos) => texto.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (c) => {
  const k = c.toLowerCase();
  if (PERMITIDOS.has(k)) return c;
  avisos.add(`correo tapado: ${CORREOS[k] ?? "<CORREO>"}`);
  return CORREOS[k] ?? "<CORREO>";
});

const firma = (nodes, connections) => JSON.stringify({ nodes: (nodes ?? []).map(({ position, ...n }) => n), connections });

for (const archivo of archivos) {
  const w = JSON.parse(readFileSync(join(entrada, archivo), "utf8"));
  const avisos = new Set();
  const pin = w.pinData && Object.keys(w.pinData).length > 0;
  if (pin) avisos.add(`traia datos de prueba fijados en ${Object.keys(w.pinData).length} nodo(s): se quitaron`);
  const pub = w.activeVersion;
  const historia = pub?.workflowPublishHistory ?? [];
  const borradorIgual = pub ? firma(w.nodes, w.connections) === firma(pub.nodes, pub.connections) : null;
  const limpio = {
    name: w.name,
    id: w.id,
    active: w.active,
    nodes: w.nodes,
    connections: w.connections,
    settings: w.settings,
    nodeGroups: w.nodeGroups ?? [],
    _respaldo: {
      exportado_de_n8n: w.updatedAt,
      publicado_en: historia.length ? historia[historia.length - 1].createdAt : null,
      version_publicada: w.activeVersionId ?? null,
      version_del_editor: w.versionId ?? null,
      editor_igual_a_publicado: borradorIgual,
      credenciales_usadas: (w.usedCredentials ?? []).map((c) => `${c.name} (${c.type})`)
    }
  };
  // Si el editor trae cambios sin publicar, también se guarda lo publicado.
  if (borradorIgual === false) {
    limpio._respaldo.publicado = { nodes: pub.nodes, connections: pub.connections };
    avisos.add("el editor tiene cambios SIN publicar: se guardaron las dos versiones");
  }
  let texto = JSON.stringify(limpio, null, 2) + "\n";
  texto = tapar(texto, avisos);
  for (const [re, nombre] of SOSPECHOSOS) {
    for (const m of texto.match(re) ?? []) {
      if (m === LLAVE_PUBLICA_SENDGRID || LLAVE_PUBLICA_SENDGRID.includes(m)) continue;
      avisos.add(`REVISAR ${nombre}: ${m.slice(0, 12)}...`);
    }
  }
  const nombreSalida = w.name.replace(/[·.()]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").toLowerCase() + ".json";
  writeFileSync(join(salida, nombreSalida), texto);
  reporte.push({ archivo: nombreSalida, id: w.id, activo: w.active, publicado: limpio._respaldo.publicado_en, editor_igual: borradorIgual, avisos: [...avisos] });
}
console.log(JSON.stringify(reporte, null, 2));
