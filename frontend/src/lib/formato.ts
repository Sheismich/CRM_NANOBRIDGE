// Formatos compartidos por las pantallas (ficha de cliente, reportes).

export const formatoMonedaEntera = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
export const formatoMoneda = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export const formatoFecha = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" });
export const formatoFechaHora = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

// Columna DATE: "2026-10-01" solo, new Date() lo toma como medianoche UTC
// y en México se mostraría como el día anterior.
export function fechaLocal(valor: string) {
  return new Date(valor.length === 10 ? `${valor}T00:00:00` : valor);
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
