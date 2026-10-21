import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import type { ResumenFicha } from "../types";

// Resumen con IA en la ficha del cliente (etapa 4). Ver src/resumen-ficha/
// en el backend.

// Empieza con ["timeline", empresaId] a propósito: cuando algo refresca el
// Historial (una llamada, una respuesta), también se refresca el aviso de
// "hay movimientos nuevos desde este resumen".
const clave = (empresaId: number) => ["timeline", empresaId, "resumen-ia"] as const;

export function useResumenFicha(empresaId: number) {
  return useQuery({
    queryKey: clave(empresaId),
    queryFn: () => api.get<ResumenFicha>(`/api/v1/empresas/${empresaId}/resumen-ia`)
  });
}

export function useGenerarResumen(empresaId: number) {
  const queryClient = useQueryClient();
  return async () => {
    const nuevo = await api.post<ResumenFicha>(`/api/v1/empresas/${empresaId}/resumen-ia`);
    queryClient.setQueryData(clave(empresaId), nuevo);
    return nuevo;
  };
}
