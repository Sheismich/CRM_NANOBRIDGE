// Cómo se escriben los números y fechas en los PDF (bloque 6, 12-oct-2026),
// igual que en los diseños de docs/diseno: "$452,260.80", "$1.28M",
// "3 oct 2026", "Octubre 2026".
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

const conCentavos = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sinCentavos = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const entero = new Intl.NumberFormat("en-US");
const fechaHora = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function aNumero(valor: string | number | null | undefined): number {
  const numero = Number(valor ?? 0);
  return Number.isFinite(numero) ? numero : 0;
}

/** "$452,260.80" (las columnas DECIMAL llegan como texto). */
export function dinero(valor: string | number | null | undefined): string {
  const numero = aNumero(valor);
  return `${numero < 0 ? "−" : ""}$${conCentavos.format(Math.abs(numero))}`;
}

/** "$96,400" -- montos de tablas donde los centavos estorban. */
export function dineroEntero(valor: string | number | null | undefined): string {
  const numero = aNumero(valor);
  return `${numero < 0 ? "−" : ""}$${sinCentavos.format(Math.abs(numero))}`;
}

/** "$1.28M", "$96K", "$950" -- tarjetas y gráficas. */
export function dineroCorto(valor: string | number | null | undefined): string {
  const numero = aNumero(valor);
  const absoluto = Math.abs(numero);
  const signo = numero < 0 ? "−" : "";
  if (absoluto >= 1_000_000) return `${signo}$${Number((absoluto / 1_000_000).toFixed(2))}M`;
  if (absoluto >= 1_000) return `${signo}$${Math.round(absoluto / 1_000)}K`;
  return `${signo}$${Math.round(absoluto)}`;
}

export function numero(valor: number): string {
  return entero.format(valor);
}

/** "10.9%" (null = no hay con qué calcularlo). */
export function porcentaje(valor: number | null | undefined): string {
  return valor == null ? "—" : `${Number(valor.toFixed(1))}%`;
}

/** "2026-10-03" → "3 oct 2026". */
export function fechaCorta(fecha: string): string {
  const [anio, mes, dia] = fecha.slice(0, 10).split("-").map(Number) as [number, number, number];
  return `${dia} ${MESES[mes - 1]} ${anio}`;
}

/** "2026-10" → "Octubre 2026". */
export function mesLargo(mes: string): string {
  const [anio, numeroMes] = mes.split("-").map(Number) as [number, number];
  return `${MESES_LARGOS[numeroMes - 1]} ${anio}`;
}

/** "2026-10" → "oct". */
export function mesCorto(mes: string): string {
  return MESES[Number(mes.slice(5, 7)) - 1]!;
}

/** Un instante en hora de México: "11 oct 2026, 18:40". */
export function fechaHoraMx(instante: Date): string {
  const [fecha, hora] = fechaHora.format(instante).split(", ") as [string, string];
  return `${fechaCorta(fecha)}, ${hora}`;
}
