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

// Instante UTC en que empieza el día `fecha` (AAAA-MM-DD) en México, ya
// formateado "AAAA-MM-DD HH:MM:SS" para MySQL (D3 del plan de fixes,
// 2-oct-2026). Va como texto porque mysql2 formatea un Date de JS con la
// zona de la máquina: en una compu en hora de México se corría 6 horas.
export function inicioDelDiaMxSql(fecha: string): string {
  const instante = new Date(`${fecha}T00:00:00${desfaseMx(new Date(`${fecha}T18:00:00Z`))}`);
  return instante.toISOString().slice(0, 19).replace("T", " ");
}

// El día siguiente a `fecha` (AAAA-MM-DD), en calendario.
export function diaSiguiente(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// "GMT-06:00" -> "-06:00" (desfase de México en ese instante).
function desfaseMx(instante: Date): string {
  const nombre = formatoDesfase.formatToParts(instante).find((p) => p.type === "timeZoneName")!.value;
  const desfase = nombre.replace("GMT", "");
  return desfase === "" ? "+00:00" : desfase;
}

// El día de calendario de México en `instante`, como fecha UTC "de
// mentiras" a medianoche (solo importan año, mes y día): así la aritmética
// de calendario no depende de la zona del servidor.
function calendarioMx(instante: Date): Date {
  const [anio, mes, dia] = fechaMx(instante).split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(anio, mes - 1, dia));
}

// Avanza `fecha` (de calendarioMx) `dias` días hábiles: solo brinca sábado
// y domingo; no conoce días festivos (16-sep, 20-nov, 25-dic...). Si hace
// falta, va una tabla de festivos.
function avanzarDiasHabiles(fecha: Date, dias: number): Date {
  const result = new Date(fecha);
  let sumados = 0;
  while (sumados < dias) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) sumados++;
  }
  return result;
}

/**
 * `ahora` + `dias` días hábiles del calendario de México, a la misma hora
 * (B8 del plan de fixes, 2-oct-2026). Es la ventana de espera entre envíos
 * ("cinco días hábiles", PLAN_N8N_DEFINITIVO.md). Antes se contaba con el
 * reloj del servidor (UTC en Cloud Run): un envío del viernes 7 pm en
 * México ya era sábado y la ventana vencía el jueves siguiente.
 *
 * Se suman días completos de 24 h: México no cambia de horario desde 2022,
 * así que la hora en México queda igual.
 */
export function sumarDiasHabilesMx(ahora: Date, dias: number): Date {
  const inicio = calendarioMx(ahora);
  const diasCalendario = Math.round((avanzarDiasHabiles(inicio, dias).getTime() - inicio.getTime()) / 86_400_000);
  return new Date(ahora.getTime() + diasCalendario * 86_400_000);
}

/**
 * Fin (23:59:59, hora de México) del siguiente día hábil después de
 * `ahora`, como instante UTC -- así se guarda y así lo compara la alerta de
 * SLA (fecha_limite < CURRENT_TIMESTAMP). Un jueves a las 7 pm en México ya
 * es viernes en UTC: contar en UTC daba lunes en vez de viernes.
 */
export function finSiguienteDiaHabilMx(ahora: Date): Date {
  const iso = avanzarDiasHabiles(calendarioMx(ahora), 1).toISOString().slice(0, 10);
  // Desfase a mediodía de ese día: México ya no cambia de horario desde
  // 2022, pero así sigue siendo correcto si eso cambiara.
  return new Date(`${iso}T23:59:59${desfaseMx(new Date(`${iso}T18:00:00Z`))}`);
}
