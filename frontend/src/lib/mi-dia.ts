import { isoDia } from "./inicio";
import type { Tarea } from "../types";

// Lógica de Tareas (Mi día y Ver todas), sin componentes.

const PESO_PRIORIDAD: Record<Tarea["prioridad"], number> = { urgente: 0, alta: 1, media: 2, baja: 3 };
const DIAS_LARGOS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const dos = (n: number) => String(n).padStart(2, "0");

export type Grupo = "vencidas" | "hoy" | "proximas" | "sin_fecha" | "cerradas";
export const ETIQUETA_GRUPO: Record<Grupo, string> = { vencidas: "Vencidas", hoy: "Hoy", proximas: "Próximas", sin_fecha: "Sin fecha", cerradas: "Cerradas" };

export function grupoDe(t: Pick<Tarea, "fecha_limite" | "estado">, ahora: Date): Grupo {
  if (t.estado === "cerrada" || t.estado === "cancelada") return "cerradas";
  if (!t.fecha_limite) return "sin_fecha";
  const f = new Date(t.fecha_limite);
  if (f.getTime() < ahora.getTime()) return "vencidas";
  return isoDia(f) === isoDia(ahora) ? "hoy" : "proximas";
}

const ORDEN_GRUPO: Record<Grupo, number> = { vencidas: 0, hoy: 1, proximas: 2, sin_fecha: 3, cerradas: 4 };

// "Lo siguiente que toca, primero": vencidas (la más vieja primero), las
// de hoy y las próximas por hora, y al final las sin fecha. Dentro de lo
// mismo, la de más prioridad.
export function ordenarPorUrgencia<T extends Pick<Tarea, "fecha_limite" | "estado" | "prioridad" | "id">>(tareas: T[], ahora: Date): T[] {
  return [...tareas].sort((a, b) => {
    const g = ORDEN_GRUPO[grupoDe(a, ahora)] - ORDEN_GRUPO[grupoDe(b, ahora)];
    if (g !== 0) return g;
    const fa = a.fecha_limite ? new Date(a.fecha_limite).getTime() : 0;
    const fb = b.fecha_limite ? new Date(b.fecha_limite).getTime() : 0;
    return fa - fb || PESO_PRIORIDAD[a.prioridad] - PESO_PRIORIDAD[b.prioridad] || a.id - b.id;
  });
}

export function hora(d: Date) {
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

// "Martes 13 de octubre"
export function fechaLarga(d: Date) {
  const dia = DIAS_LARGOS[d.getDay()];
  return `${dia[0].toUpperCase()}${dia.slice(1)} ${d.getDate()} de ${MESES_LARGOS[d.getMonth()]}`;
}

// Lo que dice arriba a la derecha de la tarea: "Venció el 5 oct, 12:09",
// "Vence hoy a las 16:00", "Vence el 20 oct, 09:00", "Sin fecha límite".
export function textoVence(fechaLimite: string | null, ahora: Date) {
  if (!fechaLimite) return "Sin fecha límite";
  const f = new Date(fechaLimite);
  if (f.getTime() < ahora.getTime()) return `Venció el ${f.getDate()} ${MESES[f.getMonth()]}, ${hora(f)}`;
  if (isoDia(f) === isoDia(ahora)) return `Vence hoy a las ${hora(f)}`;
  return `Vence el ${f.getDate()} ${MESES[f.getMonth()]}, ${hora(f)}`;
}

// El dato "Vence" del detalle: "Hoy, 23:00", "11 oct, 11:26", "Sin fecha".
export function fechaVence(fechaLimite: string | null, ahora: Date) {
  if (!fechaLimite) return "Sin fecha";
  const f = new Date(fechaLimite);
  return isoDia(f) === isoDia(ahora) ? `Hoy, ${hora(f)}` : `${f.getDate()} ${MESES[f.getMonth()]}, ${hora(f)}`;
}

// Etiqueta corta de la lista: "-4 d" (vencida), "16:00" (hoy), "20 oct", "—".
export function venceCorto(fechaLimite: string | null, ahora: Date) {
  if (!fechaLimite) return "—";
  const f = new Date(fechaLimite);
  if (f.getTime() < ahora.getTime()) {
    const dias = Math.floor((ahora.getTime() - f.getTime()) / 86_400_000);
    return dias === 0 ? hora(f) : `-${dias} d`;
  }
  if (isoDia(f) === isoDia(ahora)) return hora(f);
  return `${f.getDate()} ${MESES[f.getMonth()]}`;
}

// La cajita de "Después": arriba la hora, abajo HOY / el día.
export function cajaHora(fechaLimite: string | null, ahora: Date): { arriba: string; abajo: string } | null {
  if (!fechaLimite) return null;
  const f = new Date(fechaLimite);
  const abajo = isoDia(f) === isoDia(ahora) ? "HOY" : f.getTime() < ahora.getTime() ? "VENCIDA" : `${f.getDate()} ${MESES[f.getMonth()].toUpperCase()}`;
  return { arriba: hora(f), abajo };
}

// "hace 2 h", "hace 5 min", "hace 3 días".
export function hace(fecha: string, ahora: Date) {
  const min = Math.max(0, Math.round((ahora.getTime() - new Date(fecha).getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

// Atajos de "Reprogramar": a las 9:00 de mañana, en 2 días y el lunes que
// viene (si hoy es lunes, el de la otra semana).
export function atajosReprogramar(ahora: Date) {
  const a = (dias: number) => {
    const d = new Date(ahora);
    d.setDate(d.getDate() + dias);
    d.setHours(9, 0, 0, 0);
    return d;
  };
  const hastaLunes = ((8 - ahora.getDay()) % 7) || 7;
  return [
    { etiqueta: "Mañana 9:00", fecha: a(1) },
    { etiqueta: "En 2 días", fecha: a(2) },
    { etiqueta: "Próximo lunes", fecha: a(hastaLunes) }
  ];
}

// Valor para <input type="datetime-local"> (hora local, sin zona).
export function valorDatetimeLocal(d: Date) {
  return `${isoDia(d)}T${hora(d)}`;
}

// Liga para marcar: tel: o WhatsApp.
export function ligaTelefono(t: { tipo: "telefono" | "whatsapp"; valor: string }) {
  const digitos = t.valor.replace(/[^\d+]/g, "");
  return t.tipo === "whatsapp" ? `https://wa.me/${digitos.replace(/^\+/, "")}` : `tel:${digitos}`;
}
