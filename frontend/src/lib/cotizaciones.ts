import type { EstadoCotizacion } from "../types";

// Estados de cotización compartidos por la pestaña de la ficha y la lista
// general de Cotizaciones.

export const ETIQUETA_ESTADO_COTIZACION: Record<EstadoCotizacion, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  obsoleta: "Obsoleta"
};

export function claseEstadoCotizacion(estado: EstadoCotizacion) {
  if (estado === "aceptada") return "bg-ok-bg text-ok";
  if (estado === "rechazada" || estado === "vencida") return "bg-danger-bg text-danger";
  if (estado === "enviada") return "bg-warn-bg text-warn";
  return "bg-bg text-ink-2";
}
