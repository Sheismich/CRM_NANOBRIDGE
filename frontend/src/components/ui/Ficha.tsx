import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Icono } from "./Icono";
import type { NombreIcono } from "./iconos";

// Chip con ícono: empresa, contacto y campaña en Mi día, y los filtros
// tipo "Tipo  Todos ▾" de Documentos/Empresas. Con `to` es un enlace,
// con `onClick` un botón, sin nada solo texto. `activa` lo marca en azul
// (filtro aplicado).
export function Ficha({
  icono,
  to,
  onClick,
  activa = false,
  className,
  children
}: {
  icono?: NombreIcono | ReactNode;
  to?: string;
  onClick?: () => void;
  activa?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const clases = clsx(
    "inline-flex max-w-full items-center gap-1.5 rounded-[11px] border px-3 py-1.5 text-[13px] font-semibold",
    activa ? "border-navy bg-navy-bg text-navy" : "border-border bg-card text-ink-2",
    (to || onClick) && "hover:border-navy/40 hover:text-strong",
    className
  );
  const contenido = (
    <>
      {icono && <span className="shrink-0 text-ink-3">{typeof icono === "string" ? <Icono nombre={icono as NombreIcono} size={15} /> : icono}</span>}
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
  if (to) {
    return (
      <Link to={to} className={clases}>
        {contenido}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={clases}>
        {contenido}
      </button>
    );
  }
  return <span className={clases}>{contenido}</span>;
}
