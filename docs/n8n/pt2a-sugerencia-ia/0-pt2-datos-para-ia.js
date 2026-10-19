// ============================================================
// PT2 · "Datos para IA"  (pegar completo en el nodo Code, después de
// "Responder 200"). Junta lo que necesita el subflujo PT2a. La decisión
// de si se manda o no a Gemini la toma PT2a, no este nodo.
// ============================================================
const r = $('Leer respuesta').first().json;
const api = $('Registrar respuesta').first().json;

return [{
  json: {
    remitente: r.remitente,
    contenido: r.contenido,
    automatica: r.automatica === true,
    respuesta_id: api.id ?? null,
    tarea_id: api.tarea_id ?? null,
    identificada: api.identificada === true,
    ya_existia: api.ya_existia === true,
    contacto_nombre: api.contacto_nombre ?? null,
    empresa_nombre: api.empresa_nombre ?? null
  }
}];
