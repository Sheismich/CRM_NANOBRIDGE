// Tonos de color compartidos por Pastilla y Contador.
export type Tono = "ok" | "warn" | "danger" | "info" | "navy" | "neutro";

export const CLASE_TONO: Record<Tono, string> = {
  ok: "bg-ok-bg text-ok",
  warn: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-info",
  navy: "bg-navy-bg text-navy",
  neutro: "bg-soft text-ink-2"
};

// Color sólido del tono (puntito de Pastilla y Contador, barra de abajo).
export const COLOR_TONO: Record<Tono, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  danger: "bg-danger",
  info: "bg-info",
  navy: "bg-navy",
  neutro: "bg-ink-3"
};
