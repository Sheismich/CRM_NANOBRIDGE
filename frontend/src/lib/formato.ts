// Formatos compartidos por las pantallas (ficha de cliente, reportes).

export const formatoMonedaEntera = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
export const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
// "$120K" / "$1.28M", como los prototipos. Se arma a mano porque Intl cambia
// según el entorno ("$120 k", "120k$"). Los millones llevan hasta dos
// decimales: "$1M" escondía casi 300 mil. Oportunidades, Cotizaciones y Reportes.
function compactoTexto(n: number) {
  const cantidad = Math.abs(n);
  const signo = n < 0 ? "-" : "";
  if (cantidad >= 999_500) return `${signo}$${Math.round(cantidad / 10_000) / 100}M`;
  if (cantidad >= 999.5) return `${signo}$${Math.round(cantidad / 1_000)}K`;
  return `${signo}$${Math.round(cantidad)}`;
}
export const compacto = { format: compactoTexto };
export const formatoFecha = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
// "3 oct": tarjetas de los tableros.
export const formatoDiaMes = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
export const formatoFechaHora = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

// Columna DATE: "2026-10-01" solo, new Date() lo toma como medianoche UTC
// y en México se mostraría como el día anterior.
export function fechaLocal(valor: string) {
  return new Date(valor.length === 10 ? `${valor}T00:00:00` : valor);
}

// DATETIME que el backend manda sin pasar por Drizzle (subconsultas con
// MAX(), ej. ultimo_envio_en): llega "YYYY-MM-DD HH:MM:SS" en UTC, sin la Z.
// Si ya viene en ISO se lee tal cual.
export function fechaUtc(valor: string) {
  return new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(valor) ? `${valor.replace(" ", "T")}Z` : valor);
}

// "2026-10" (mes de GET /reportes/forecast) → "oct 2026".
const formatoMes = new Intl.DateTimeFormat("es-MX", { month: "short", year: "numeric" });
export function etiquetaMes(mes: string) {
  return formatoMes.format(fechaLocal(`${mes}-01`));
}

// "1 oportunidad abierta" / "3 oportunidades abiertas".
export function plural(n: number, singular: string, pluralTexto: string) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

export function formatoTamano(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
