import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import type { Paginated } from "../types";

// Campañas (src/campanas, 1-oct-2026). Todos leen; solo administrador y
// supervisor crean, editan y cambian de estado.

export type EstadoCampana = "borrador" | "activa" | "pausada" | "finalizada";
// Por qué no manda hoy (shared/campana-vigente.ts); null cuando sí manda.
export type MotivoCampana = "pausada" | "aun_no_empieza" | "finalizada" | "vencida" | "borrador";

export type Campana = {
  id: number;
  nombre: string;
  // La columna admite whatsapp, pero la API solo crea de correo.
  canal: "correo" | "whatsapp";
  estado: EstadoCampana;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  prospectos: number;
  activa_hoy: boolean;
  motivo: MotivoCampana | null;
  creado_en: string;
  actualizado_en: string;
};

export const ETIQUETA_ESTADO_CAMPANA: Record<EstadoCampana, string> = {
  borrador: "Borrador",
  activa: "Activa",
  pausada: "Pausada",
  finalizada: "Finalizada"
};

export const CLASE_ESTADO_CAMPANA: Record<EstadoCampana, string> = {
  borrador: "bg-bg text-ink-3",
  activa: "bg-ok-bg text-ok",
  pausada: "bg-warn-bg text-warn",
  finalizada: "bg-bg text-ink-3"
};

export const ETIQUETA_MOTIVO_CAMPANA: Record<MotivoCampana, string> = {
  pausada: "En pausa: sus recordatorios esperan",
  aun_no_empieza: "Todavía no llega su fecha de inicio",
  finalizada: "Finalizada",
  vencida: "Ya pasó su fecha de fin",
  borrador: "En borrador: no manda nada"
};

// Qué acciones ofrece cada estado: el mismo mapa TRANSICIONES de
// campanas.service.ts. "Finalizar" es definitivo.
export const ACCIONES_CAMPANA: Record<EstadoCampana, ("activar" | "pausar" | "finalizar")[]> = {
  borrador: ["activar", "finalizar"],
  activa: ["pausar", "finalizar"],
  pausada: ["activar", "finalizar"],
  finalizada: []
};

// El backend pagina de a 100 como máximo; para los selectores basta con las
// 100 más recientes.
export function useCampanas() {
  return useQuery({
    queryKey: ["campanas", "todas"],
    queryFn: () => api.get<Paginated<Campana>>("/api/v1/campanas", { limit: 100 })
  });
}

// Para asignarle prospectos: las que todavía pueden mandar (no finalizadas).
export function campanasAsignables(campanas: Campana[] | undefined) {
  return (campanas ?? []).filter((c) => c.estado !== "finalizada");
}
