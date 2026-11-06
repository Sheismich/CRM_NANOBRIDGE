import type { TipoRegistro } from "../types";

// Filtros del Registro de cambios (6-nov-2026), sin componentes. La lista y la
// exportación arman su consulta con parametrosRegistro: por eso lo que se baja
// es exactamente lo que se ve. Por lo mismo la pantalla siempre manda las dos
// fechas: si faltara una, la API exportaría los últimos 30 días y la lista
// traería todo el historial.

export type FiltrosRegistro = { tipo: "todo" | TipoRegistro; q: string; desde: string; hasta: string; usuarioId: number | null; accion: string };

export type Rango = Pick<FiltrosRegistro, "desde" | "hasta">;

// GET /admin/registro-cambios/filtros
export type AccionRegistro = { clave: string; etiqueta: string; tipo: TipoRegistro };
export type PersonaRegistro = { id: number; nombre: string; activo: boolean };
export type OpcionesFiltros = { acciones: AccionRegistro[]; personas: PersonaRegistro[] };

export type RangoRapido = "hoy" | "ayer" | "7" | "30";

export const RANGOS_RAPIDOS: { id: RangoRapido; etiqueta: string }[] = [
  { id: "hoy", etiqueta: "Hoy" },
  { id: "ayer", etiqueta: "Ayer" },
  { id: "7", etiqueta: "7 días" },
  { id: "30", etiqueta: "30 días" }
];

// Mismo calendario que la API (src/shared/dia-habil.ts): el día y la hora de
// México, aunque el navegador esté en otra zona.
const ZONA_MX = "America/Mexico_City";
const formatoDia = new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_MX, year: "numeric", month: "2-digit", day: "2-digit" });
const formatoHora = new Intl.DateTimeFormat("en-GB", { timeZone: ZONA_MX, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function diaMx(instante: Date) {
  return formatoDia.format(instante);
}

export function horaMx(instante: Date) {
  return formatoHora.format(instante);
}

function sumarDias(dia: string, dias: number) {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function rangoRapido(id: RangoRapido, ahora: Date): Rango {
  const hoy = diaMx(ahora);
  if (id === "hoy") return { desde: hoy, hasta: hoy };
  if (id === "ayer") return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
  return { desde: sumarDias(hoy, -(Number(id) - 1)), hasta: hoy };
}

export function rangoActivo(rango: Rango, ahora: Date): RangoRapido | null {
  const encontrado = RANGOS_RAPIDOS.find(({ id }) => {
    const candidato = rangoRapido(id, ahora);
    return candidato.desde === rango.desde && candidato.hasta === rango.hasta;
  });
  return encontrado?.id ?? null;
}

export function filtrosIniciales(ahora: Date): FiltrosRegistro {
  return { tipo: "todo", q: "", ...rangoRapido("30", ahora), usuarioId: null, accion: "" };
}

// El año va de cuatro cifras: mientras se escribe a mano, "0202-11-03" ya es
// una fecha para el navegador pero todavía no es la que se quiere.
const fechaCompleta = (fecha: string) => /^20\d{2}-\d{2}-\d{2}$/.test(fecha);

export function errorDeRango({ desde, hasta }: Rango): string | null {
  if (!fechaCompleta(desde) || !fechaCompleta(hasta)) return "Elige las dos fechas.";
  return desde > hasta ? "La fecha Desde no puede ser después de Hasta." : null;
}

export function parametrosRegistro(f: FiltrosRegistro) {
  return { tipo: f.tipo, desde: f.desde, hasta: f.hasta, ...(f.q ? { q: f.q } : {}), ...(f.usuarioId ? { usuarioId: f.usuarioId } : {}), ...(f.accion ? { accion: f.accion } : {}) };
}

export function urlExportar(f: FiltrosRegistro, formato: "pdf" | "csv") {
  const qs = new URLSearchParams({ formato });
  for (const [clave, valor] of Object.entries(parametrosRegistro(f))) qs.set(clave, String(valor));
  return `/api/v1/admin/registro-cambios/export?${qs.toString()}`;
}

export function accionesDelTipo(acciones: AccionRegistro[], tipo: FiltrosRegistro["tipo"]) {
  return tipo === "todo" ? acciones : acciones.filter((a) => a.tipo === tipo);
}

export function cambiarTipo(f: FiltrosRegistro, tipo: FiltrosRegistro["tipo"], acciones: AccionRegistro[]): FiltrosRegistro {
  const sigue = accionesDelTipo(acciones, tipo).some((a) => a.clave === f.accion);
  return { ...f, tipo, accion: sigue ? f.accion : "" };
}

export function hayFiltros(f: FiltrosRegistro, ahora: Date) {
  const inicio = filtrosIniciales(ahora);
  return f.tipo !== inicio.tipo || f.q !== inicio.q || f.desde !== inicio.desde || f.hasta !== inicio.hasta || f.usuarioId !== inicio.usuarioId || f.accion !== inicio.accion;
}
