import type { ReactNode } from "react";
import { clsx } from "clsx";
import { COLOR_TONO, type Tono } from "./tonos";

// Contador de arriba de una lista (Documentos: Por revisar / Aprobados /
// Expedientes incompletos / Rechazados; Empresas, Contactos...): puntito y
// etiqueta en mayúsculas, número grande, detalle chico y barra de color
// abajo. Con `onClick` sirve de filtro y `seleccionado` lo marca.
// Se acomodan en <FilaContadores>.
export function Contador({
  etiqueta,
  valor,
  detalle,
  tono = "navy",
  seleccionado = false,
  onClick
}: {
  etiqueta: ReactNode;
  valor: ReactNode;
  detalle?: ReactNode;
  tono?: Tono;
  seleccionado?: boolean;
  onClick?: () => void;
}) {
  const contenido = (
    <>
      <div className="flex items-center gap-1.5 font-heading text-[11px] font-extrabold uppercase tracking-[1.5px] text-ink-2">
        <span className={clsx("h-[7px] w-[7px] shrink-0 rounded-full", COLOR_TONO[tono])} />
        <span className="truncate">{etiqueta}</span>
      </div>
      <div className="mono mt-1.5 font-display text-[34px] leading-none text-strong">{valor}</div>
      {detalle && <div className="mt-2 truncate text-[12px] text-ink-3">{detalle}</div>}
      <span className={clsx("absolute inset-x-0 bottom-0 h-[3px]", COLOR_TONO[tono])} />
    </>
  );
  const clases = clsx(
    // w-full: como botón (con onClick) no se estira solo y en el celular se salía de su columna.
    "tarjeta-blanca relative block w-full min-w-0 overflow-hidden px-4 pb-4 pt-3.5 text-left",
    seleccionado && "!border-navy ring-1 ring-navy"
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={seleccionado} className={clsx(clases, "cursor-pointer hover:border-navy/40")}>
        {contenido}
      </button>
    );
  }
  return <div className={clases}>{contenido}</div>;
}

// 2 columnas en el celular, 4 (o las que quepan) en compu.
export function FilaContadores({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(200px,1fr))] md:gap-3", className)}>{children}</div>;
}
