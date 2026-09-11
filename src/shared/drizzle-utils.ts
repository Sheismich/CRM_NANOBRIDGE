// Filtra los `undefined` de un arreglo de condiciones drizzle opcionales
// (filtros que solo aplican cuando el query param correspondiente vino en
// la petición) antes de pasarlo a and(...). El type guard se repetía
// copiado y pegado en cada servicio (cotizaciones, oportunidades, tareas,
// reportes) -- centralizado aquí para no tener que corregirlo N veces si
// cambia (ej. si algún día también hay que filtrar `null`).
export function compactConditions<T>(conditions: (T | undefined)[]): T[] {
  return conditions.filter((c): c is T => c !== undefined);
}
