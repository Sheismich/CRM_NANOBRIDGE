import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "./api";
import { horaEvento } from "./inicio";

// Avisos (GET /api/v1/notificaciones, etapa 2 de las mejoras,
// 19-oct-2026): cada quien ve solo sus avisos. Desde el 20-oct no hay
// campanita: el numerito va en Inicio y la tarjeta "Lo nuevo para ti"
// abre el panel (docs/diseno/avisos-menu.html opción D, panel versión 2
// de docs/diseno/avisos-panel.html).

export type TipoAviso = "tarea_asignada" | "interesado" | "tarea_vencida" | "documento_rechazado" | "respuesta_por_clasificar" | "respuesta_conversacion";

export interface Notificacion {
  id: number;
  tipo: TipoAviso;
  titulo: string;
  cuerpo: string | null;
  enlace: string | null;
  leida: boolean;
  creado_en: string;
}

// El numerito: cada minuto y al volver a la pestaña.
export function useConteoNotificaciones() {
  return useQuery({
    queryKey: ["notificaciones", "conteo"],
    queryFn: () => api.get<{ no_leidas: number }>("/api/v1/notificaciones/conteo"),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000
  });
}

// Los sin leer más recientes, para la tarjeta del Inicio.
export function useAvisosNuevos() {
  return useQuery({
    queryKey: ["notificaciones", "nuevos"],
    queryFn: () => api.get<{ notificaciones: Notificacion[]; no_leidas: number }>("/api/v1/notificaciones", { solo_no_leidas: "true", limit: 5 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000
  });
}

// La lista, solo mientras el panel está abierto.
export function useNotificaciones(abierto: boolean) {
  return useQuery({
    queryKey: ["notificaciones", "lista"],
    queryFn: () => api.get<{ notificaciones: Notificacion[]; no_leidas: number }>("/api/v1/notificaciones"),
    enabled: abierto,
    staleTime: 0
  });
}

export function usePreferenciasAvisos(abierto: boolean) {
  return useQuery({
    queryKey: ["notificaciones", "preferencias"],
    queryFn: () => api.get<{ avisos_por_correo: boolean }>("/api/v1/notificaciones/preferencias"),
    enabled: abierto,
    staleTime: 5 * 60_000
  });
}

export async function marcarLeida(queryClient: QueryClient, id: number) {
  await api.patch(`/api/v1/notificaciones/${id}/leida`);
  await queryClient.invalidateQueries({ queryKey: ["notificaciones"] });
}

export async function leerTodas(queryClient: QueryClient) {
  await api.post("/api/v1/notificaciones/leer-todas");
  await queryClient.invalidateQueries({ queryKey: ["notificaciones"] });
}

// Cada tipo con su color: rayita a la izquierda y etiqueta chica (sin
// emojis ni íconos). Un tipo que el front aún no conozca sale en gris.
const TIPOS: Record<TipoAviso, { etiqueta: string; raya: string; pastilla: string }> = {
  tarea_asignada: { etiqueta: "Tarea", raya: "bg-navy", pastilla: "bg-navy-bg text-navy" },
  interesado: { etiqueta: "Interesado", raya: "bg-ok", pastilla: "bg-ok-bg text-ok" },
  tarea_vencida: { etiqueta: "Vencida", raya: "bg-danger", pastilla: "bg-danger-bg text-danger" },
  documento_rechazado: { etiqueta: "Documento", raya: "bg-warn", pastilla: "bg-warn-bg text-warn" },
  respuesta_por_clasificar: { etiqueta: "Por clasificar", raya: "bg-info", pastilla: "bg-info-bg text-info" },
  // Etapa 3: el cliente contestó a un correo que le mandaste desde el CRM.
  respuesta_conversacion: { etiqueta: "Te contestó", raya: "bg-ok", pastilla: "bg-ok-bg text-ok" }
};
export function tipoAviso(tipo: string) {
  return TIPOS[tipo as TipoAviso] ?? { etiqueta: "Aviso", raya: "bg-ink-3", pastilla: "bg-soft text-ink-2" };
}

// "ahora", "hace 5 min", "10:15 a.m.", "ayer 4:30 p.m.", "13 oct".
export function horaAviso(fecha: string, ahora: Date) {
  const d = new Date(fecha);
  const minutos = Math.floor((ahora.getTime() - d.getTime()) / 60_000);
  if (minutos < 1) return "ahora";
  if (minutos < 60) return `hace ${minutos} min`;
  const h = horaEvento(fecha, ahora);
  const hora = d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
  if (/^\d\d:\d\d$/.test(h)) return hora;
  if (h === "Ayer") return `ayer ${hora}`;
  return h;
}

export async function cambiarAvisosPorCorreo(queryClient: QueryClient, valor: boolean) {
  const res = await api.put<{ avisos_por_correo: boolean }>("/api/v1/notificaciones/preferencias", { avisos_por_correo: valor });
  queryClient.setQueryData(["notificaciones", "preferencias"], res);
}

// Clic en un aviso: se marca leído y se va a lo que avisa. Si no se pudo
// marcar, igual se abre.
export function useAbrirAviso(antes?: () => void) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return async (aviso: Notificacion) => {
    try {
      if (!aviso.leida) await marcarLeida(queryClient, aviso.id);
    } catch {
      // Se abre de todos modos.
    }
    antes?.();
    if (aviso.enlace) navigate(aviso.enlace);
  };
}
