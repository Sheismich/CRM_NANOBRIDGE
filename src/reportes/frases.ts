import { dineroCorto } from "../shared/pdf/formato.js";

// Reporte del periodo (16-oct-2026): los rangos de cada periodo y las
// frases que explican cada sección, para el PDF de Reportes. Son las mismas
// reglas que usa la pantalla (frontend/src/lib/reportes.ts): si cambia una
// frase allá, cambiarla aquí también, para que el PDF diga lo mismo que se
// ve. Diferencias a propósito: aquí no hay "▲"/"▼" en el texto (el molde
// dibuja la flecha) y los montos van con dineroCorto, como el resto de los
// PDF.

export const PERIODOS = ["semana", "mes", "trimestre", "anio"] as const;
export type PeriodoReporte = (typeof PERIODOS)[number];
export type Rango = { fechaInicio: string; fechaFin: string };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const ETIQUETA_TIPO_TAREA: Record<string, string> = {
  seguimiento: "Seguimiento",
  clasificacion: "Clasificación",
  revision_documento: "Revisión de documento",
  otro: "Otro"
};

// Fechas de calendario como "AAAA-MM-DD": se trabaja en UTC solo para que
// la cuenta no dependa de la zona del servidor.
function aFecha(iso: string) {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}
function aIso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function sumarDias(d: Date, dias: number) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + dias));
}
// El mismo día n meses antes; si ese mes es más corto, su último día.
function mesesAntes(d: Date, n: number) {
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, Math.min(d.getUTCDate(), ultimo)));
}

// Del inicio del periodo a hoy, y el mismo tramo del periodo anterior (del 1
// al 15 de septiembre contra del 1 al 15 de octubre). `hoy` es el día de
// México. `contra` y `titulo` son los textos de la pantalla; `contraCorto`,
// el de las tarjetas del PDF, que son angostas.
export function rangosDelPeriodo(periodo: PeriodoReporte, hoyIso: string) {
  const hoy = aFecha(hoyIso);
  let inicio: Date;
  let inicioAnterior: Date;
  let finAnterior: Date;
  let contra: string;
  let titulo: string;
  if (periodo === "semana") {
    inicio = sumarDias(hoy, -((hoy.getUTCDay() + 6) % 7));
    inicioAnterior = sumarDias(inicio, -7);
    finAnterior = sumarDias(hoy, -7);
    contra = "la semana pasada";
    titulo = "esta semana";
  } else if (periodo === "mes") {
    inicio = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
    inicioAnterior = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1));
    finAnterior = mesesAntes(hoy, 1);
    contra = MESES_CORTOS[inicioAnterior.getUTCMonth()]!;
    titulo = MESES[hoy.getUTCMonth()]!;
  } else if (periodo === "trimestre") {
    inicio = new Date(Date.UTC(hoy.getUTCFullYear(), Math.floor(hoy.getUTCMonth() / 3) * 3, 1));
    inicioAnterior = mesesAntes(inicio, 3);
    finAnterior = mesesAntes(hoy, 3);
    contra = "el trimestre anterior";
    titulo = `${MESES_CORTOS[inicio.getUTCMonth()]}–${MESES_CORTOS[inicio.getUTCMonth() + 2]}`;
  } else {
    inicio = new Date(Date.UTC(hoy.getUTCFullYear(), 0, 1));
    inicioAnterior = new Date(Date.UTC(hoy.getUTCFullYear() - 1, 0, 1));
    finAnterior = mesesAntes(hoy, 12);
    contra = String(hoy.getUTCFullYear() - 1);
    titulo = String(hoy.getUTCFullYear());
  }
  return {
    actual: { fechaInicio: aIso(inicio), fechaFin: hoyIso },
    anterior: { fechaInicio: aIso(inicioAnterior), fechaFin: aIso(finAnterior) },
    contra,
    contraCorto: periodo === "semana" ? "sem. pasada" : periodo === "trimestre" ? "trim. anterior" : contra,
    titulo
  };
}

export type Cambio = { texto: string; sentido: "arriba" | "abajo" | null; bueno: boolean | null };

// "18% vs sep" con su sentido. `subirEsBueno` = false para lo que conviene que baje.
export function cambioPct(actual: number, anterior: number | null | undefined, contra: string, subirEsBueno = true): Cambio | null {
  if (anterior == null) return null;
  if (anterior === 0) return actual === 0 ? { texto: `igual que ${contra}`, sentido: null, bueno: null } : { texto: `nuevo vs ${contra}`, sentido: "arriba", bueno: subirEsBueno };
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return { texto: `igual que ${contra}`, sentido: null, bueno: null };
  const sube = pct > 0;
  return { texto: `${Math.abs(pct)}% vs ${contra}`, sentido: sube ? "arriba" : "abajo", bueno: sube === subirEsBueno };
}

// "2.7 pts vs sep" (diferencia entre dos porcentajes).
export function cambioPuntos(actual: number | null, anterior: number | null | undefined, contra: string): Cambio | null {
  if (actual == null || anterior == null) return null;
  const pts = Math.round((actual - anterior) * 10) / 10;
  if (pts === 0) return { texto: `igual que ${contra}`, sentido: null, bueno: null };
  return { texto: `${Math.abs(pts)} pts vs ${contra}`, sentido: pts > 0 ? "arriba" : "abajo", bueno: pts > 0 };
}

export function pct(valor: number | null | undefined) {
  return valor == null ? "—" : `${Math.round(valor * 10) / 10}%`;
}

export function plural(n: number, singular: string, pluralTexto: string) {
  return `${n} ${n === 1 ? singular : pluralTexto}`;
}

const primerNombre = (nombre: string) => nombre.split(/\s+/)[0] ?? nombre;
const lista = (nombres: string[]) => (nombres.length <= 1 ? nombres.join("") : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`);

// --- Frases de cada sección ---

type EtapaConversion = { etapa_clave: string; etapa_nombre: string; orden: number; oportunidades_alcanzadas: number; conversion_desde_calificada_pct: number | null };

export function fraseConversion(c: { base_calificadas: number; etapas: EtapaConversion[] }) {
  if (c.base_calificadas === 0) return "Todavía no hay oportunidades calificadas en este periodo.";
  const ganada = c.etapas.find((e) => e.etapa_clave === "ganada");
  const ganadas = ganada?.oportunidades_alcanzadas ?? 0;
  if (ganadas === 0) return `Ninguna de las ${c.base_calificadas} oportunidades calificadas se ha ganado todavía.`;
  const uno = Math.max(1, Math.round(c.base_calificadas / ganadas));
  return `De cada ${uno} oportunidades calificadas, 1 se cierra con éxito (${pct(ganada?.conversion_desde_calificada_pct)} de tasa neta).`;
}

// La caída más grande entre dos etapas seguidas: "de Propuesta a Negociación (−34%)".
export function caidaMaxima(c: { etapas: EtapaConversion[] }) {
  const etapas = [...c.etapas].sort((a, b) => a.orden - b.orden);
  let mejor: { texto: string; caida: number } | null = null;
  for (let i = 0; i + 1 < etapas.length; i++) {
    const a = etapas[i]!.conversion_desde_calificada_pct;
    const b = etapas[i + 1]!.conversion_desde_calificada_pct;
    if (a == null || b == null) continue;
    const caida = Math.round(a - b);
    if (caida > 0 && (!mejor || caida > mejor.caida)) mejor = { texto: `de ${etapas[i]!.etapa_nombre} a ${etapas[i + 1]!.etapa_nombre} (−${caida}%)`, caida };
  }
  return mejor?.texto ?? null;
}

export function fraseForecast(meses: { mes: string; valor_estimado_total: string; valor_ponderado: string }[]) {
  const total = meses.reduce((s, m) => s + Number(m.valor_estimado_total), 0);
  if (total === 0) return "No hay oportunidades abiertas con fecha de cierre en los próximos meses.";
  const ponderado = meses.reduce((s, m) => s + Number(m.valor_ponderado), 0);
  const mayor = meses.reduce((a, b) => (Number(b.valor_estimado_total) > Number(a.valor_estimado_total) ? b : a));
  const parte = Math.round((Number(mayor.valor_estimado_total) / total) * 100);
  const mes = MESES[Number(mayor.mes.slice(5, 7)) - 1]!;
  const cuanto = `${dineroCorto(total)} en total, ${dineroCorto(ponderado)} ponderado`;
  return parte === 100 ? `Todo lo esperado cierra en ${mes}: ${cuanto}.` : `${mes[0]!.toUpperCase()}${mes.slice(1)} concentra el ${parte}% de lo esperado: ${cuanto}.`;
}

export function fraseProspeccion(dias: { fecha: string; envios: number; respuestas: number }[]) {
  const envios = dias.reduce((s, d) => s + d.envios, 0);
  const respuestas = dias.reduce((s, d) => s + d.respuestas, 0);
  if (envios === 0 && respuestas === 0) return "No salieron correos de la prospección en este periodo.";
  if (respuestas === 0) return `Salieron ${envios} correos y todavía no hay respuestas.`;
  const mejor = dias.reduce((a, b) => (b.respuestas > a.respuestas ? b : a));
  const [, m, d] = mejor.fecha.split("-").map(Number) as [number, number, number];
  return `El mejor día de respuestas fue el ${DIAS[aFecha(mejor.fecha).getUTCDay()]} ${d} de ${MESES[m - 1]}, con ${mejor.respuestas}.`;
}

export function fraseTareas(t: { creadas: { total: number; por_tipo: { tipo: string; cantidad: number }[] } }) {
  const [mayor] = t.creadas.por_tipo;
  if (!mayor || t.creadas.total === 0) return "No se crearon tareas en este periodo.";
  const parte = Math.round((mayor.cantidad / t.creadas.total) * 100);
  return `El ${parte}% de las tareas del periodo son de ${(ETIQUETA_TIPO_TAREA[mayor.tipo] ?? mayor.tipo).toLowerCase()}.`;
}

type FilaDesempeno = { responsable_id: number; responsable_nombre: string; actividades: { total: number }; tareas: { vencidas: number }; oportunidades: { ganadas: number } };

export function fraseDesempeno(filas: FilaDesempeno[]) {
  if (filas.length === 0) return "No hay agentes activos.";
  const porVolumen = [...filas].sort((a, b) => b.actividades.total - a.actividades.total);
  const lider = porVolumen[0]!;
  const ganadasTotal = filas.reduce((s, f) => s + f.oportunidades.ganadas, 0);
  const partes: string[] = [];
  if (lider.actividades.total === 0) partes.push("Nadie registró actividades en este periodo");
  else {
    let texto = `${primerNombre(lider.responsable_nombre)} lleva el volumen (${lider.actividades.total} actividades)`;
    if (ganadasTotal > 0) {
      const cerrador = [...filas].sort((a, b) => b.oportunidades.ganadas - a.oportunidades.ganadas)[0]!;
      if (cerrador.responsable_id === lider.responsable_id) texto += ganadasTotal === 1 ? " y el único cierre" : ` y ${cerrador.oportunidades.ganadas} de los ${ganadasTotal} cierres`;
      else texto += `; ${primerNombre(cerrador.responsable_nombre)} lleva más cierres (${cerrador.oportunidades.ganadas})`;
    }
    partes.push(texto);
  }
  const conVencidas = filas.filter((f) => f.tareas.vencidas > 0);
  if (conVencidas.length === 0) partes.push("nadie tiene tareas vencidas");
  else if (conVencidas.length < filas.length) partes.push(`${lista(filas.filter((f) => f.tareas.vencidas === 0).map((f) => primerNombre(f.responsable_nombre)))} no ${filas.length - conVencidas.length === 1 ? "tiene" : "tienen"} tareas vencidas`);
  return `${partes.join("; ")}.`;
}

// "1 jul – 16 oct 2026" para el encabezado.
export function rangoLegible(r: Rango) {
  const [ya, ma, da] = r.fechaInicio.split("-").map(Number) as [number, number, number];
  const [yb, mb, db] = r.fechaFin.split("-").map(Number) as [number, number, number];
  const inicio = `${da} ${MESES_CORTOS[ma - 1]}${ya !== yb ? ` ${ya}` : ""}`;
  return `${inicio} – ${db} ${MESES_CORTOS[mb - 1]} ${yb}`;
}
