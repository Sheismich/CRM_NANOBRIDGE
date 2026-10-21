import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "./api";

// Buscador general (GET /api/v1/buscar, etapa 5 de las mejoras,
// 21-oct-2026): 6 grupos, 5 por grupo, con las mismas reglas de cada
// lista. "Ver más" pide 5 más de un grupo con `grupo` y `desde`.

export const GRUPOS = ["empresas", "contactos", "prospectos", "oportunidades", "cotizaciones", "tareas"] as const;
export type Grupo = (typeof GRUPOS)[number];

export interface FilaBuscador {
  id: number;
  titulo: string;
  detalle: string | null;
  empresa_id: number | null;
}
export type ResultadoGrupo = { data: FilaBuscador[]; hay_mas: boolean };
export type ResultadoBuscador = Record<Grupo, ResultadoGrupo>;

export const ETIQUETA_GRUPO: Record<Grupo, string> = {
  empresas: "Empresas",
  contactos: "Contactos",
  prospectos: "Prospectos",
  oportunidades: "Oportunidades",
  cotizaciones: "Cotizaciones",
  tareas: "Tareas"
};

export function useBuscar(q: string) {
  const texto = q.trim();
  return useQuery({
    queryKey: ["buscar", texto],
    queryFn: () => api.get<ResultadoBuscador>("/api/v1/buscar", { q: texto }),
    enabled: texto.length > 0,
    // Mientras llega lo nuevo se quedan los resultados de antes (no parpadea).
    placeholderData: keepPreviousData,
    staleTime: 30_000
  });
}

export async function buscarMas(q: string, grupo: Grupo, desde: number) {
  const r = await api.get<Partial<ResultadoBuscador>>("/api/v1/buscar", { q: q.trim(), grupo, desde });
  return r[grupo] ?? { data: [], hay_mas: false };
}

// A dónde lleva cada resultado. Solo Empresas tiene ficha propia: contactos,
// oportunidades y cotizaciones abren la de su empresa (en su pestaña).
export function ligaDe(grupo: Grupo, fila: FilaBuscador): string {
  const empresa = `/empresas/${fila.empresa_id}`;
  switch (grupo) {
    case "empresas":
      return `/empresas/${fila.id}`;
    case "contactos":
      return empresa;
    case "prospectos":
      return `/prospectos?prospecto=${fila.id}`;
    case "oportunidades":
      return `${empresa}?tab=oportunidades`;
    case "cotizaciones":
      return `${empresa}?tab=cotizaciones`;
    case "tareas":
      return `/tareas?vista=todas&tarea=${fila.id}`;
  }
}
