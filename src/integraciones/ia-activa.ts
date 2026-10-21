import { env } from "../config/env.js";

// ¿La API está usando la IA de verdad? (21-oct-2026) Con IA_DRIVER=falso
// (producción hasta encender Gemini, RUNBOOK §10) la IA falsa contesta vacío
// y "Redactar con IA" (etapa 3) o "Resumir con IA" (etapa 4) darían 502. Con
// este dato el front los enseña desactivados en lugar de dejar que fallen.
export function iaActiva(): boolean {
  return env.IA_DRIVER === "gemini";
}
