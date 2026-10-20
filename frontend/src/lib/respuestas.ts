import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { ContextoRespuesta } from "../types";

// Responder al prospecto desde el CRM (etapa 3, 20-oct-2026). Ver
// src/respuestas-vendedor/ en el backend.

export function useContextoRespuesta(respuestaId: number | null) {
  return useQuery({
    queryKey: ["respuestas", "contestar", respuestaId],
    queryFn: () => api.get<ContextoRespuesta>(`/api/v1/respuestas/${respuestaId}/contestar`),
    enabled: respuestaId !== null,
    staleTime: 0
  });
}

export function pedirBorrador(respuestaId: number) {
  return api.post<{ borrador_id: number; texto: string }>(`/api/v1/respuestas/${respuestaId}/borrador-ia`);
}

export async function contestarRespuesta(queryClient: QueryClient, respuestaId: number, cuerpo: { texto: string; borrador_id?: number; cerrar_tarea: boolean }, empresaId: number) {
  const res = await api.post<{ id: number; estado: "enviado"; tarea_cerrada: boolean }>(`/api/v1/respuestas/${respuestaId}/contestar`, cuerpo);
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["timeline", empresaId] }),
    queryClient.invalidateQueries({ queryKey: ["respuestas", "contestar", respuestaId] }),
    queryClient.invalidateQueries({ queryKey: ["tareas"] })
  ]);
  return res;
}

// Las que nunca se contestan (P3.1): ahí ni se ofrece el botón.
export const CLASIFICACIONES_SIN_RESPONDER = new Set(["baja", "no_interesado", "invalido", "automatica"]);
