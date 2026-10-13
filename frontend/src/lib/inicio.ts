import type { EventoReciente } from "../types";

// Lógica del Inicio (sin componentes): fechas, saludo y cómo se agrupa
// "Lo que acaba de pasar". Las fechas son las del navegador, que en el
// equipo es hora de México, igual que el backend (fechaMx).

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const dos = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DD" del día local.
export function isoDia(d: Date) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

function sumarDias(d: Date, dias: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + dias);
  return r;
}

export function rangosInicio(ahora: Date) {
  const hoy = isoDia(ahora);
  const inicioMes = isoDia(new Date(ahora.getFullYear(), ahora.getMonth(), 1));
  const inicioMesAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const finMesAnterior = new Date(ahora.getFullYear(), ahora.getMonth(), 0);
  // La gráfica va del día 1 a hoy, pero con al menos 7 días: el día 2 del
  // mes una gráfica de dos puntos no dice nada.
  const inicioGrafica = ahora.getDate() >= 7 ? inicioMes : isoDia(sumarDias(ahora, -6));
  return {
    hoy,
    mes: { fechaInicio: inicioMes, fechaFin: hoy },
    mesAnterior: { fechaInicio: isoDia(inicioMesAnterior), fechaFin: isoDia(finMesAnterior) },
    grafica: { fechaInicio: inicioGrafica, fechaFin: hoy },
    nombreMes: MESES[ahora.getMonth()],
    nombreMesAnterior: MESES[inicioMesAnterior.getMonth()]
  };
}

export function saludo(ahora: Date) {
  const h = ahora.getHours();
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}

// "Mié 8 oct · 09:45"
export function fechaFranja(ahora: Date) {
  return `${DIAS[ahora.getDay()]} ${ahora.getDate()} ${MESES_CORTOS[ahora.getMonth()]} · ${dos(ahora.getHours())}:${dos(ahora.getMinutes())}`;
}

// "8 oct" a partir de "YYYY-MM-DD".
export function diaCorto(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MESES_CORTOS[m - 1]}`;
}

// "1–8 oct", o "25 sep – 1 oct" si cruza de mes.
export function etiquetaRango(desde: string, hasta: string) {
  const [, m1, d1] = desde.split("-").map(Number);
  const [, m2] = hasta.split("-").map(Number);
  return m1 === m2 ? `${d1}–${diaCorto(hasta)}` : `${diaCorto(desde)} – ${diaCorto(hasta)}`;
}

// Hora del feed: "09:42" si es de hoy, "Ayer", o "6 oct".
export function horaEvento(fecha: string, ahora: Date) {
  const d = new Date(fecha);
  if (isoDia(d) === isoDia(ahora)) return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
  if (isoDia(d) === isoDia(sumarDias(ahora, -1))) return "Ayer";
  return `${d.getDate()} ${MESES_CORTOS[d.getMonth()]}`;
}

// numero_contacto: 1 = correo inicial, 2 y 3 = recordatorios.
export function textoContacto(numero: number, cantidad: number) {
  if (numero <= 1) return cantidad === 1 ? "correo inicial" : "correos iniciales";
  const cual = numero === 2 ? "1er" : "2º";
  return cantidad === 1 ? `${cual} recordatorio` : `${cual} recordatorios`;
}

// Qué contestó, en palabras de la pantalla.
export const TEXTO_CLASIFICACION: Record<string, string> = {
  interesado: "le interesa",
  no_interesado: "no le interesa",
  baja: "pidió su baja",
  invalido: "respuesta inválida",
  reagendar: "que le escribamos después",
  automatica: "respuesta automática",
  ambigua: "no quedó claro"
};

export type ElementoFeed =
  | { tipo: "respuesta"; clave: string; fecha: string; evento: Extract<EventoReciente, { tipo: "respuesta" }> }
  | { tipo: "cola"; clave: string; fecha: string; cantidad: number }
  | { tipo: "envios"; clave: string; fecha: string; cantidad: number; numero: number; campana: string | null; persona: Extract<EventoReciente, { tipo: "envio" }> }
  | { tipo: "baja"; clave: string; fecha: string; evento: Extract<EventoReciente, { tipo: "baja" }> };

// Junta el feed para leerlo de un vistazo:
// - las respuestas que esperan clasificación se vuelven UN renglón ("N
//   respuestas esperan clasificación"), en el lugar de la más nueva;
// - los envíos seguidos de la misma campaña, mismo número de contacto y
//   mismo día se vuelven un lote ("Se enviaron 12 recordatorios").
export function agruparFeed(eventos: EventoReciente[]): ElementoFeed[] {
  const salida: ElementoFeed[] = [];
  let cola: Extract<ElementoFeed, { tipo: "cola" }> | null = null;
  for (const ev of eventos) {
    if (ev.tipo === "respuesta" && ev.estado === "pendiente_clasificacion") {
      if (cola) cola.cantidad += 1;
      else {
        cola = { tipo: "cola", clave: `cola-${ev.fecha}`, fecha: ev.fecha, cantidad: 1 };
        salida.push(cola);
      }
      continue;
    }
    if (ev.tipo === "envio") {
      const ultimo = salida[salida.length - 1];
      if (ultimo?.tipo === "envios" && ultimo.persona.campana_id === ev.campana_id && ultimo.numero === ev.numero_contacto && isoDia(new Date(ultimo.fecha)) === isoDia(new Date(ev.fecha))) {
        ultimo.cantidad += 1;
        continue;
      }
      salida.push({ tipo: "envios", clave: `envio-${ev.prospecto_id}-${ev.fecha}`, fecha: ev.fecha, cantidad: 1, numero: ev.numero_contacto, campana: ev.campana_nombre, persona: ev });
      continue;
    }
    if (ev.tipo === "respuesta") salida.push({ tipo: "respuesta", clave: `resp-${ev.prospecto_id}-${ev.fecha}`, fecha: ev.fecha, evento: ev });
    else salida.push({ tipo: "baja", clave: `baja-${ev.prospecto_id}-${ev.fecha}`, fecha: ev.fecha, evento: ev });
  }
  return salida;
}

// Porcentaje con un decimal y sin ".0": 10.9%, 8%.
export function pct(v: number | null | undefined) {
  if (v == null) return "—";
  return `${Number(v.toFixed(1))}%`;
}
