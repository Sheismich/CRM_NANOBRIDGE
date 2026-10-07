import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";

// Lista vacía sin filtros: qué pasa y el siguiente paso, con su botón
// (PLAN_FRONTEND.md, "Pantallas menos genéricas"). Con filtros puestos
// basta el texto de "No hay … con ese filtro".
export function EstadoVacio({ titulo, texto, accion, className }: { titulo: string; texto?: string; accion?: ReactNode; className?: string }) {
  return (
    <div className={clsx("flex flex-wrap items-center justify-between gap-3", className)}>
      <div>
        <div className="text-sm font-semibold">{titulo}</div>
        {texto && <div className="text-xs text-ink-3">{texto}</div>}
      </div>
      {accion}
    </div>
  );
}

// Acción que lleva a otra pantalla, con el mismo aspecto que Button "outline".
export function LigaAccion({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-block rounded-[9px] border-[1.5px] border-navy bg-card px-4 py-2 text-[13px] font-bold text-navy">
      {children}
    </Link>
  );
}
