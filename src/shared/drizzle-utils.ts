// Filtra los `undefined` de un arreglo de condiciones drizzle opcionales
// (filtros que solo aplican cuando el query param correspondiente vino en
// la petición) antes de pasarlo a and(...). El type guard se repetía
// copiado y pegado en cada servicio (cotizaciones, oportunidades, tareas,
// reportes) -- centralizado aquí para no tener que corregirlo N veces si
// cambia (ej. si algún día también hay que filtrar `null`).
export function compactConditions<T>(conditions: (T | undefined)[]): T[] {
  return conditions.filter((c): c is T => c !== undefined);
}

// Snapshot "antes" para auditoría: dado el valor previo de una fila y el
// objeto parcial `set` que se le va a aplicar, arma un objeto con solo los
// valores previos de los campos que van a cambiar. Este mismo par de líneas
// estaba copiado en EmpresasService.update() y .updateContact() -- se
// centraliza aquí por el mismo motivo que compactConditions (hallazgo de
// code review, 14-sep-2026).
export function buildAntes<T extends Record<string, unknown>>(before: T, set: Partial<T>): Partial<T> {
  const antes: Partial<T> = {};
  for (const key of Object.keys(set) as (keyof T)[]) antes[key] = before[key];
  return antes;
}
