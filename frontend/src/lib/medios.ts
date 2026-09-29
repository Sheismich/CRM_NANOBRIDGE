import type { MedioContacto } from "../types";

// Medios de contacto: etiquetas y color por estado, compartidos por la
// ficha de cliente, Prospectos y Contactos.

export const ETIQUETA_MEDIO: Record<string, string> = {
  correo: "Correo",
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  sitio_web: "Sitio web",
  facebook: "Facebook",
  instagram: "Instagram"
};

// no_contactar = supresión (pidió que no le escriban); se ve en rojo.
export function claseMedio(estado: MedioContacto["estado_contacto"] | null) {
  if (estado === "no_contactar") return "bg-danger-bg text-danger";
  if (estado === "obsoleto") return "bg-bg text-ink-3";
  return "bg-ok-bg text-ok";
}
