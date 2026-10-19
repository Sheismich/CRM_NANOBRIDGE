// ============================================================
// PT2a · "Revisar guardado"  (pegar completo en el nodo Code)
// "Guardar sugerencia" va con Never Error + respuesta completa, así que
// aquí se decide: 200/201 = guardada; 409 = una persona ya la clasificó
// (normal, se ignora); cualquier otra cosa = error -> B4 avisa.
// ============================================================
const r = $input.first().json;
const status = r.statusCode;

if (status === 200 || status === 201) {
  return [{ json: { ok: true, status, resultado: r.body } }];
}
if (status === 409) {
  return [{ json: { ok: true, status, nota: "Una persona ya la había clasificado; la sugerencia no se guarda." } }];
}
throw new Error(`La API no guardó la sugerencia (status ${status}): ${JSON.stringify(r.body).slice(0, 300)}`);
