import type { ReactNode } from "react";
import { clsx } from "clsx";

// Selector de segmentos del rediseño: las pestañas de Prospectos
// (Prospectos · Importaciones · Campañas) y el "Lista | Tarjetas" de
// Empresas y Contactos. `cuenta` es el numerito de la derecha. En el
// celular ocupa todo el ancho y reparte las opciones.
export function Segmento<T extends string>({
  opciones,
  valor,
  onCambiar,
  etiqueta,
  className
}: {
  opciones: { id: T; texto: ReactNode; cuenta?: number }[];
  valor: T;
  onCambiar: (id: T) => void;
  etiqueta: string;
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={etiqueta} className={clsx("flex w-full gap-0.5 rounded-[12px] border border-border bg-soft p-1 md:inline-flex md:w-auto", className)}>
      {opciones.map((o) => {
        const activa = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={activa}
            onClick={() => onCambiar(o.id)}
            className={clsx(
              "flex min-w-0 flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-[9px] px-1.5 py-2 text-[12.5px] font-bold md:flex-none md:gap-1.5 md:px-4 md:text-[13px]",
              activa ? "bg-card text-strong shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-strong"
            )}
          >
            {o.texto}
            {o.cuenta !== undefined && <span className={clsx("mono rounded-full px-1.5 text-[11px]", activa ? "bg-cyan text-navy-ink" : "bg-border text-ink-2")}>{o.cuenta}</span>}
          </button>
        );
      })}
    </div>
  );
}
