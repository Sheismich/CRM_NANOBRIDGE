import { useSyncExternalStore } from "react";

// ¿Pantalla de celular? Mismo corte que Tailwind `md` (768 px) y que las
// barras del celular. Para lo que cambia de comportamiento, no solo de
// estilo (ej. el detalle de una tarea va al lado en compu y en un panel en
// el celular).
const CONSULTA = "(max-width: 767.98px)";

function suscribir(avisar: () => void) {
  const mq = window.matchMedia(CONSULTA);
  mq.addEventListener("change", avisar);
  return () => mq.removeEventListener("change", avisar);
}

export function useEsCelular() {
  return useSyncExternalStore(suscribir, () => window.matchMedia(CONSULTA).matches);
}
