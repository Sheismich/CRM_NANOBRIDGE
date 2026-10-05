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

// Medios que nacieron en no_contactar al confirmar un prospecto porque
// estaban en la lista de baja (medios_suprimidos de confirmarFila,
// 2-oct-2026). null si no hubo ninguno.
const MEDIO_EN_FRASE: Record<string, string> = { correo: "correo", telefono: "teléfono", whatsapp: "WhatsApp" };
export function avisoMediosSuprimidos(medios: string[] | undefined) {
  if (!medios?.length) return null;
  const nombres = medios.map((m) => MEDIO_EN_FRASE[m] ?? m).join(" y ");
  return `El ${nombres} de esta persona está en la lista de baja: quedó marcado "no contactar" y la automatización no le escribirá por ahí.`;
}
