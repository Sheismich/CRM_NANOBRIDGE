import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "./api";

// La campanita (GET /api/v1/notificaciones, etapa 2 de las mejoras,
// 19-oct-2026): cada quien ve solo sus avisos.

export interface Notificacion {
  id: number;
  tipo: "tarea_asignada" | "interesado" | "tarea_vencida" | "documento_rechazado" | "respuesta_por_clasificar";
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

export async function cambiarAvisosPorCorreo(queryClient: QueryClient, valor: boolean) {
  const res = await api.put<{ avisos_por_correo: boolean }>("/api/v1/notificaciones/preferencias", { avisos_por_correo: valor });
  queryClient.setQueryData(["notificaciones", "preferencias"], res);
}
