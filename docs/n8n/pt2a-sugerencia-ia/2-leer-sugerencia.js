// ============================================================
// PT2a · "Leer sugerencia"  (pegar completo en el nodo Code)
// Si Gemini falló o contestó algo raro, se detiene aquí sin error:
// la respuesta ya está registrada y su tarea ya está en la cola.
// ============================================================
const base = $('Preparar texto para IA').first().json;
const VALIDAS = ["interesado", "no_interesado", "baja", "automatica", "ambigua"];

const partes = $json.candidates?.[0]?.content?.parts || [];
const textoGemini = partes
  .filter((p) => typeof p.text === "string" && !p.thought)
  .map((p) => p.text)
  .join("");

let s;
try {
  s = JSON.parse(textoGemini);
} catch (e) {
  return [];
}
if (!s || !VALIDAS.includes(s.clasificacion)) return [];

let confianza = Number(s.confianza);
if (!Number.isFinite(confianza)) return [];
if (confianza > 0 && confianza < 1) confianza = confianza * 100; // por si contesta 0.9
confianza = Math.max(0, Math.min(100, Math.round(confianza)));

return [{
  json: {
    respuesta_id: base.respuesta_id,
    clasificacion: s.clasificacion,
    confianza,
    motivo: String(s.motivo || "").trim().slice(0, 300)
  }
}];
