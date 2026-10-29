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

const formatoHora = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_MX, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

// La hora (HH:MM, 24 h) que marca el reloj en México en ese instante.
export function horaMx(instante: Date): string {
  return formatoHora.format(instante);
}

// `fecha` (AAAA-MM-DD) más `dias` de calendario (negativo = hacia atrás).
export function sumarDiasFecha(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// El lunes (AAAA-MM-DD) de la semana de `fecha`.
export function lunesDeLaSemana(fecha: string): string {
  return sumarDiasFecha(fecha, -((new Date(`${fecha}T00:00:00Z`).getUTCDay() + 6) % 7));
}

// Días de calendario de `desde` a `hasta` (AAAA-MM-DD); negativo si `hasta`
// es antes.
export function diasEntreFechas(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000);
}

// El día anterior a `fecha` (AAAA-MM-DD), en calendario.
export function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
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

// El `n`-ésimo lunes del mes (1-12) de `anio`, como AAAA-MM-DD.
function nesimoLunes(anio: number, mes: number, n: number): string {
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  primero.setUTCDate(1 + ((8 - primero.getUTCDay()) % 7) + (n - 1) * 7);
  return primero.toISOString().slice(0, 10);
}

/**
 * Descansos obligatorios de la Ley Federal del Trabajo, art. 74 (29-oct-2026):
 * se calculan por regla, así no hay tabla que actualizar cada año. No incluye
 * el día de la jornada electoral (fracción IX: cae en domingo) ni días que la
 * ley no marca (Jueves y Viernes Santo, 12-dic): si la empresa los descansa,
 * se agregan aquí.
 */
export function esFeriadoMx(fecha: string): boolean {
  const anio = Number(fecha.slice(0, 4));
  const mesDia = fecha.slice(5);
  if (["01-01", "05-01", "09-16", "12-25"].includes(mesDia)) return true;
  // 1-oct cada seis años, cuando cambia el Ejecutivo Federal (2024, 2030...).
  if (mesDia === "10-01" && (anio - 2024) % 6 === 0) return true;
  return fecha === nesimoLunes(anio, 2, 1) || fecha === nesimoLunes(anio, 3, 3) || fecha === nesimoLunes(anio, 11, 3);
}

// Avanza `fecha` (de calendarioMx) `dias` días hábiles: brinca sábado,
// domingo y feriados (esFeriadoMx).
function avanzarDiasHabiles(fecha: Date, dias: number): Date {
  const result = new Date(fecha);
  let sumados = 0;
  while (sumados < dias) {
    result.setUTCDate(result.getUTCDate() + 1);
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6 && !esFeriadoMx(result.toISOString().slice(0, 10))) sumados++;
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
