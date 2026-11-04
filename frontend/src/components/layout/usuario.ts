export const ETIQUETA_ROL: Record<string, string> = {
  administrador: "Administrador",
  supervisor: "Supervisor",
  agente: "Agente"
};

// Solo letras y números: "Mich (pasante)" daba "M(" (4-nov-2026).
export function iniciales(nombre: string) {
  const partes = nombre.replace(/[^\p{L}\p{N}\s]/gu, "").trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}
