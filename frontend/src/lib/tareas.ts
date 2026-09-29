import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { plural } from "./formato";
import type { Clasificacion, Paginated, Tarea, TareaClasificacion } from "../types";

// Etiquetas de tareas compartidas por Tareas, Reportes e Inicio.

export const ETIQUETA_TIPO_TAREA: Record<Tarea["tipo"], string> = {
  seguimiento: "Seguimiento",
  clasificacion: "Clasificación",
  revision_documento: "Revisión de documento",
  otro: "Otro"
};

export const ETIQUETA_ESTADO_TAREA: Record<Tarea["estado"], string> = {
  pendiente: "Pendiente",
  en_progreso: "En progreso",
  cerrada: "Cerrada",
  cancelada: "Cancelada"
};

export const ETIQUETA_PRIORIDAD: Record<Tarea["prioridad"], string> = {
  urgente: "Urgente",
  alta: "Alta",
  media: "Media",
  baja: "Baja"
};

export const CLASE_PRIORIDAD: Record<Tarea["prioridad"], string> = {
  urgente: "bg-danger-bg text-danger",
  alta: "bg-warn-bg text-warn",
  media: "bg-bg text-ink-2",
  baja: "bg-bg text-ink-3"
};

export const ETIQUETA_CLASIFICACION: Record<Clasificacion, string> = {
  interesado: "Interesado",
  no_interesado: "No interesado",
  baja: "Baja",
  invalido: "Inválido",
  reagendar: "Reagendar"
};

// Vencida = fecha límite pasada y la tarea sigue abierta (mismo criterio
// que ReportesService.tareasReporte).
export function estaVencida(t: Pick<Tarea, "fecha_limite" | "estado">) {
  return Boolean(t.fecha_limite) && new Date(t.fecha_limite!).getTime() < Date.now() && t.estado !== "cerrada" && t.estado !== "cancelada";
}

// Cola de clasificación (solo admin/supervisor). Compartida por la pestaña
// de Tareas y el contador del Inicio: misma queryKey, misma caché.
export const LIMITE_COLA = 25;
export function useColaClasificacion(page = 1, habilitada = true) {
  return useQuery({
    queryKey: ["tareas", "cola-clasificacion", page],
    queryFn: () => api.get<Paginated<TareaClasificacion>>("/api/v1/cola-clasificacion", { page, limit: LIMITE_COLA }),
    enabled: habilitada
  });
}

// La API no devuelve el total: con la primera página llena solo se sabe
// que hay "25 o más".
export function textoPendientesCola(n: number) {
  return n >= LIMITE_COLA ? `${n}+ respuestas por clasificar` : plural(n, "respuesta por clasificar", "respuestas por clasificar");
}
