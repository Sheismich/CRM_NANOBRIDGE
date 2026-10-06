import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import type { Oportunidad, Paginated } from "../../types";

// Las oportunidades de la empresa: las usan la pestaña Oportunidades y los
// selects de Cotizaciones y Documentos. Misma queryKey, así comparten caché.
// Filtro empresaId en GET /oportunidades agregado para la ficha
// (oportunidad.schema.ts). Para un agente el backend además acota a las
// suyas -- puede haber otras oportunidades de la empresa que no vea.
// empresaId 0 = todavía sin empresa ("Nueva cotización"): no consulta.
export function useOportunidadesEmpresa(empresaId: number) {
  return useQuery({
    queryKey: ["oportunidades", { empresaId }],
    queryFn: () => api.get<Paginated<Oportunidad>>("/api/v1/oportunidades", { empresaId, limit: 100 }),
    enabled: empresaId > 0
  });
}
