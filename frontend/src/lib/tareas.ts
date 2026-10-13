import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { plural } from "./formato";
import type { Clasificacion, ConteosTareas, EventoTarea, Paginated, Tarea, TareaClasificacion, TareaDetalle } from "../types";

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

// Abierta, con fecha límite hoy (día local) y todavía no vencida.
export function venceHoy(t: Pick<Tarea, "fecha_limite" | "estado">) {
  if (!t.fecha_limite || estaVencida(t) || t.estado === "cerrada" || t.estado === "cancelada") return false;
  return new Date(t.fecha_limite).toDateString() === new Date().toDateString();
}

// Conteos de Mi día de quien pregunta. Empieza con ["tareas"], así que
// cerrar o crear una tarea (que invalida ["tareas"]) lo refresca.
export function useConteosTareas() {
  return useQuery({
    queryKey: ["tareas", "conteos"],
    queryFn: () => api.get<ConteosTareas>("/api/v1/tareas/conteos"),
    staleTime: 60_000
  });
}

// Lo que le toca hoy a la persona: lo que vence hoy más lo vencido. Es el
// numerito de Tareas en el menú.
export function tareasPorAtender(c: ConteosTareas | undefined) {
  return c ? c.pendientes_hoy + c.vencidas : 0;
}

// Tareas abiertas (pendientes y en progreso) para el Inicio. GET /tareas no
// filtra por fecha ni devuelve el total: se traen hasta 100 de cada estado
// y lo vencido / de hoy se separa aquí. `completo` es false si alguno de los
// dos estados llenó la página (puede haber más de las que se cuentan).
const LIMITE_ABIERTAS = 100;
export function useTareasAbiertas() {
  return useQuery({
    queryKey: ["tareas", "abiertas-inicio"],
    queryFn: async () => {
      const [pendientes, enProgreso] = await Promise.all([
        api.get<Paginated<Tarea>>("/api/v1/tareas", { estado: "pendiente", limit: LIMITE_ABIERTAS }),
        api.get<Paginated<Tarea>>("/api/v1/tareas", { estado: "en_progreso", limit: LIMITE_ABIERTAS })
      ]);
      return {
        tareas: [...pendientes.data, ...enProgreso.data],
        completo: pendientes.data.length < LIMITE_ABIERTAS && enProgreso.data.length < LIMITE_ABIERTAS
      };
    }
  });
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

// "Tomar" (Del equipo) y "Reasignar": PATCH /tareas/:id/asignar, solo
// administrador y supervisor (los agentes no toman tareas, decisión del
// 12-oct-2026).
export async function asignarTarea(queryClient: QueryClient, tareaId: number, responsableId: number, empresaId: number | null) {
  await api.patch(`/api/v1/tareas/${tareaId}/asignar`, { responsableId });
  await queryClient.invalidateQueries({ queryKey: ["tareas"] });
  // Asignar = dar dueño: la empresa pudo cambiar de responsable.
  if (empresaId) await queryClient.invalidateQueries({ queryKey: ["empresa", String(empresaId)] });
}

// --- Rediseño de Tareas (13-oct-2026) ---

export function useTareaDetalle(id: number | null) {
  return useQuery({
    queryKey: ["tareas", "detalle", id],
    queryFn: () => api.get<TareaDetalle>(`/api/v1/tareas/${id}`),
    enabled: id !== null
  });
}

export function useHistorialTarea(id: number | null) {
  return useQuery({
    queryKey: ["tareas", "historial", id],
    queryFn: () => api.get<EventoTarea[]>(`/api/v1/tareas/${id}/historial`),
    enabled: id !== null
  });
}

export type FiltrosTareas = {
  responsableId?: number;
  sinAsignar?: boolean;
  q?: string;
  prioridad?: Tarea["prioridad"];
  tipo?: Tarea["tipo"];
  cerradas?: boolean;
};

// Lista de Ver todas y de Mi día. GET /tareas filtra por UN estado, así que
// "abiertas" son dos llamadas (pendiente + en progreso) de hasta 100 cada
// una; "cerradas" trae las 100 más recientes. `completo` es false si alguna
// llenó la página (puede haber más de las que se ven).
export function useListaTareas(filtros: FiltrosTareas, habilitada = true) {
  const base = {
    responsableId: filtros.responsableId,
    sinAsignar: filtros.sinAsignar ? "true" : undefined,
    q: filtros.q?.trim() || undefined,
    prioridad: filtros.prioridad,
    tipo: filtros.tipo,
    limit: LIMITE_ABIERTAS
  };
  return useQuery({
    queryKey: ["tareas", "lista", base, filtros.cerradas ?? false],
    enabled: habilitada,
    queryFn: async () => {
      const estados = filtros.cerradas ? (["cerrada"] as const) : (["pendiente", "en_progreso"] as const);
      const paginas = await Promise.all(estados.map((estado) => api.get<Paginated<Tarea>>("/api/v1/tareas", { ...base, estado })));
      return { tareas: paginas.flatMap((p) => p.data), completo: paginas.every((p) => p.data.length < LIMITE_ABIERTAS) };
    }
  });
}
