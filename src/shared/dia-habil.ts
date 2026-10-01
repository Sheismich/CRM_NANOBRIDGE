// La operación comercial está en México: los plazos para las personas se
// cuentan en su calendario, no en el del servidor (Cloud Run corre en UTC).
const ZONA_MX = "America/Mexico_City";

const formatoFecha = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_MX, year: "numeric", month: "2-digit", day: "2-digit" });
const formatoDesfase = new Intl.DateTimeFormat("en-US", { timeZone: ZONA_MX, timeZoneName: "longOffset" });

// La fecha (AAAA-MM-DD) que marca el calendario en México en ese instante.
// La conexión a MySQL corre en UTC (pool.ts: time_zone '+00:00'), así que
// CURDATE() cambia de día a las 6 pm de México; para comparar contra
// columnas DATE de negocio (fechas de campaña) se usa esta.
export function fechaMx(instante: Date): string {
  return formatoFecha.format(instante);
}

// "GMT-06:00" -> "-06:00" (desfase de México en ese instante).
function desfaseMx(instante: Date): string {
  const nombre = formatoDesfase.formatToParts(instante).find((p) => p.type === "timeZoneName")!.value;
  const desfase = nombre.replace("GMT", "");
  return desfase === "" ? "+00:00" : desfase;
}

/**
 * Fin (23:59:59, hora de México) del siguiente día hábil después de
 * `ahora`, como instante UTC -- así se guarda y así lo compara la alerta de
 * SLA (fecha_limite < CURRENT_TIMESTAMP). Un jueves a las 7 pm en México ya
 * es viernes en UTC: contar en UTC daba lunes en vez de viernes.
 *
 * Limitación: solo brinca sábado y domingo; no conoce días festivos
 * (16-sep, 20-nov, 25-dic...). Si hace falta, va una tabla de festivos.
 */
export function finSiguienteDiaHabilMx(ahora: Date): Date {
  const [anio, mes, dia] = formatoFecha.format(ahora).split("-").map(Number) as [number, number, number];
  // Aritmética de calendario sobre una fecha UTC "de mentiras" (solo
  // importan año, mes y día), para no depender de la zona del servidor.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  do {
    fecha.setUTCDate(fecha.getUTCDate() + 1);
  } while (fecha.getUTCDay() === 0 || fecha.getUTCDay() === 6);

  const iso = fecha.toISOString().slice(0, 10);
  // Desfase a mediodía de ese día: México ya no cambia de horario desde
  // 2022, pero así sigue siendo correcto si eso cambiara.
  return new Date(`${iso}T23:59:59${desfaseMx(new Date(`${iso}T18:00:00Z`))}`);
}
