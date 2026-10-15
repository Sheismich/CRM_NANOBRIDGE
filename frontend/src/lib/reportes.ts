import { compacto } from "./formato";
import { isoDia } from "./inicio";
import { ETIQUETA_TIPO_TAREA } from "./tareas";
import type { ConversionConCiclo, DesempenoAgente, ForecastMes, ProspeccionDia, ReporteTareasPanel } from "../types";

// Reportes del rediseño (docs/diseno/reportes.html, opción A): los rangos
// de cada periodo los calcula el front (los reportes aceptan
// fechaInicio/fechaFin) y las frases que explican cada gráfica se arman
// aquí con plantillas, a partir de los mismos números que se dibujan.

export type Periodo = "dia" | "semana" | "mes" | "trimestre" | "anio";
export type Rango = { fechaInicio: string; fechaFin: string };

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function sumarDias(d: Date, dias: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + dias);
  return r;
}

// El mismo día n meses antes; si ese mes es más corto, su último día.
function mesesAntes(d: Date, n: number) {
  const ultimo = new Date(d.getFullYear(), d.getMonth() - n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() - n, Math.min(d.getDate(), ultimo));
}

// Del inicio del periodo a hoy, y el mismo tramo del periodo anterior (del
// 1 al 15 de septiembre contra del 1 al 15 de octubre), para que la
// comparación sea pareja a mitad de periodo.
export function rangosDelPeriodo(periodo: Exclude<Periodo, "dia">, ahora: Date) {
  const hoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate());
  let inicio: Date;
  let inicioAnterior: Date;
  let finAnterior: Date;
  let contra: string;
  let titulo: string;
  if (periodo === "semana") {
    inicio = sumarDias(hoy, -((hoy.getDay() + 6) % 7));
    inicioAnterior = sumarDias(inicio, -7);
    finAnterior = sumarDias(hoy, -7);
    contra = "la semana pasada";
    titulo = "esta semana";
  } else if (periodo === "mes") {
    inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    inicioAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    finAnterior = mesesAntes(hoy, 1);
    contra = MESES_CORTOS[inicioAnterior.getMonth()];
    titulo = MESES[hoy.getMonth()];
  } else if (periodo === "trimestre") {
    inicio = new Date(hoy.getFullYear(), Math.floor(hoy.getMonth() / 3) * 3, 1);
    inicioAnterior = mesesAntes(inicio, 3);
    finAnterior = mesesAntes(hoy, 3);
    contra = "el trimestre anterior";
    titulo = `${MESES_CORTOS[inicio.getMonth()]}–${MESES_CORTOS[inicio.getMonth() + 2]}`;
  } else {
    inicio = new Date(hoy.getFullYear(), 0, 1);
    inicioAnterior = new Date(hoy.getFullYear() - 1, 0, 1);
    finAnterior = mesesAntes(hoy, 12);
    contra = String(hoy.getFullYear() - 1);
    titulo = String(hoy.getFullYear());
  }
  return {
    actual: { fechaInicio: isoDia(inicio), fechaFin: isoDia(hoy) },
    anterior: { fechaInicio: isoDia(inicioAnterior), fechaFin: isoDia(finAnterior) },
    contra,
    titulo
  };
}

export type Cambio = { texto: string; tono: "ok" | "danger" | "neutro" };

// "▲ 18% vs sep". `subirEsBueno` = false para lo que conviene que baje.
export function cambioPct(actual: number, anterior: number | null | undefined, contra: string, subirEsBueno = true): Cambio | null {
  if (anterior == null) return null;
  if (anterior === 0) return actual === 0 ? { texto: `igual que ${contra}`, tono: "neutro" } : { texto: `▲ nuevo vs ${contra}`, tono: subirEsBueno ? "ok" : "danger" };
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return { texto: `igual que ${contra}`, tono: "neutro" };
  const sube = pct > 0;
  return { texto: `${sube ? "▲" : "▼"} ${Math.abs(pct)}% vs ${contra}`, tono: sube === subirEsBueno ? "ok" : "danger" };
}

// "▲ 2.7 pts vs sep" (diferencia entre dos porcentajes).
export function cambioPuntos(actual: number | null, anterior: number | null | undefined, contra: string): Cambio | null {
  if (actual == null || anterior == null) return null;
  const pts = Math.round((actual - anterior) * 10) / 10;
  if (pts === 0) return { texto: `igual que ${contra}`, tono: "neutro" };
  return { texto: `${pts > 0 ? "▲" : "▼"} ${Math.abs(pts)} pts vs ${contra}`, tono: pts > 0 ? "ok" : "danger" };
}

export function pct(valor: number | null | undefined) {
  return valor == null ? "—" : `${Math.round(valor * 10) / 10}%`;
}

const primerNombre = (nombre: string) => nombre.split(/\s+/)[0] ?? nombre;
const lista = (nombres: string[]) => (nombres.length <= 1 ? nombres.join("") : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`);

// --- Frases de cada gráfica ---

export function fraseConversion(c: ConversionConCiclo) {
  if (c.base_calificadas === 0) return "Todavía no hay oportunidades calificadas en este periodo.";
  const ganada = c.etapas.find((e) => e.etapa_clave === "ganada");
  const ganadas = ganada?.oportunidades_alcanzadas ?? 0;
  if (ganadas === 0) return `Ninguna de las ${c.base_calificadas} oportunidades calificadas se ha ganado todavía.`;
  const uno = Math.max(1, Math.round(c.base_calificadas / ganadas));
  return `De cada ${uno} oportunidades calificadas, 1 se cierra con éxito (${pct(ganada?.conversion_desde_calificada_pct)} de tasa neta).`;
}

// La caída más grande entre dos etapas seguidas: "Propuesta → Negociación (−34%)".
export function caidaMaxima(c: ConversionConCiclo) {
  const etapas = [...c.etapas].sort((a, b) => a.orden - b.orden);
  let mejor: { texto: string; caida: number } | null = null;
  for (let i = 0; i + 1 < etapas.length; i++) {
    const a = etapas[i].conversion_desde_calificada_pct;
    const b = etapas[i + 1].conversion_desde_calificada_pct;
    if (a == null || b == null) continue;
    const caida = Math.round(a - b);
    if (caida > 0 && (!mejor || caida > mejor.caida)) mejor = { texto: `${etapas[i].etapa_nombre} → ${etapas[i + 1].etapa_nombre} (−${caida}%)`, caida };
  }
  return mejor?.texto ?? null;
}

export function fraseForecast(meses: ForecastMes[], nombreMes: (mes: string) => string) {
  const total = meses.reduce((s, m) => s + Number(m.valor_estimado_total), 0);
  if (total === 0) return "No hay oportunidades abiertas con fecha de cierre en los próximos meses.";
  const ponderado = meses.reduce((s, m) => s + Number(m.valor_ponderado), 0);
  const mayor = meses.reduce((a, b) => (Number(b.valor_estimado_total) > Number(a.valor_estimado_total) ? b : a));
  const parte = Math.round((Number(mayor.valor_estimado_total) / total) * 100);
  const mes = nombreMes(mayor.mes);
  const cuanto = `${compacto.format(total)} en total, ${compacto.format(ponderado)} ponderado`;
  return parte === 100 ? `Todo lo esperado cierra en ${mes}: ${cuanto}.` : `${mes[0].toUpperCase()}${mes.slice(1)} concentra el ${parte}% de lo esperado: ${cuanto}.`;
}

export function fraseProspeccion(dias: ProspeccionDia[]) {
  const envios = dias.reduce((s, d) => s + d.envios, 0);
  const respuestas = dias.reduce((s, d) => s + d.respuestas, 0);
  if (envios === 0 && respuestas === 0) return "No salieron correos de la prospección en este periodo.";
  if (respuestas === 0) return `Salieron ${envios} correos y todavía no hay respuestas.`;
  const mejor = dias.reduce((a, b) => (b.respuestas > a.respuestas ? b : a));
  const [y, m, d] = mejor.fecha.split("-").map(Number);
  const dia = new Date(y, m - 1, d);
  return `El mejor día de respuestas fue el ${DIAS[dia.getDay()]} ${d} de ${MESES[m - 1]}, con ${mejor.respuestas}.`;
}

export function fraseTareas(t: ReporteTareasPanel) {
  const [mayor] = t.creadas.por_tipo;
  if (!mayor || t.creadas.total === 0) return "No se crearon tareas en este periodo.";
  const parte = Math.round((mayor.cantidad / t.creadas.total) * 100);
  return `El ${parte}% de las tareas del periodo son de ${ETIQUETA_TIPO_TAREA[mayor.tipo].toLowerCase()}.`;
}

export function fraseDesempeno(filas: DesempenoAgente[]) {
  if (filas.length === 0) return "No hay agentes activos.";
  const porVolumen = [...filas].sort((a, b) => b.actividades.total - a.actividades.total);
  const lider = porVolumen[0];
  const ganadasTotal = filas.reduce((s, f) => s + f.oportunidades.ganadas, 0);
  const partes: string[] = [];
  if (lider.actividades.total === 0) partes.push("Nadie registró actividades en este periodo");
  else {
    let texto = `${primerNombre(lider.responsable_nombre)} lleva el volumen (${lider.actividades.total} actividades)`;
    if (ganadasTotal > 0) {
      const cerrador = [...filas].sort((a, b) => b.oportunidades.ganadas - a.oportunidades.ganadas)[0];
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

// --- Vista Día ---

const dos = (n: number) => String(n).padStart(2, "0");

export function horaLocal(fecha: string) {
  const d = new Date(fecha);
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// "Miércoles 8 de octubre de 2026"
export function fechaLarga(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const dia = DIAS[new Date(y, m - 1, d).getDay()];
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${d} de ${MESES[m - 1]} de ${y}`;
}

export function moverDia(iso: string, dias: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return isoDia(new Date(y, m - 1, d + dias));
}

export function nombreMesLargo(mes: string) {
  return MESES[Number(mes.slice(5, 7)) - 1];
}
