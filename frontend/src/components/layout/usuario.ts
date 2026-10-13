export const ETIQUETA_ROL: Record<string, string> = {
  administrador: "Administrador",
  supervisor: "Supervisor",
  agente: "Agente"
};

export function iniciales(nombre: string) {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}
