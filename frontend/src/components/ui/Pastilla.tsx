import type { ReactNode } from "react";
import { clsx } from "clsx";
import { CLASE_TONO, COLOR_TONO, type Tono } from "./tonos";

// Estado corto en color: "● Por revisar", "Activa", "Vencida". `punto`
// agrega el puntito de la izquierda (Documentos, Tareas).
export function Pastilla({ tono = "neutro", punto = false, mayusculas = false, className, children }: { tono?: Tono; punto?: boolean; mayusculas?: boolean; className?: string; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11px] font-extrabold",
        mayusculas && "uppercase tracking-[1.5px]",
        CLASE_TONO[tono],
        className
      )}
    >
      {punto && <span className={clsx("h-1.5 w-1.5 shrink-0 rounded-full", COLOR_TONO[tono])} />}
      {children}
    </span>
  );
}
