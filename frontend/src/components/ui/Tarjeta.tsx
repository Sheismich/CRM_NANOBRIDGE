import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Icono } from "./Icono";
import type { NombreIcono } from "./iconos";

export type ColorEncabezado = "menta" | "cyan" | "lila" | "morado";

// Tarjeta del rediseño.
// - estilo "blanca" (por omisión): tarjeta blanca con borde y sombra
//   suave, la de Tareas, Documentos, Administración y casi todo lo demás.
// - estilo "relieve": la del Inicio aprobado (variante 6), mismo color que
//   el fondo y separada por sombras; va sobre <AppShell fondo="relieve">.
// Con `titulo` lleva encabezado: ícono en un círculo hundido, título y
// `extra` a la derecha (texto chico, un enlace, un botón). `color` pinta
// el encabezado con una franja suave (menta, cyan, lila o morado).
export function Tarjeta({
  titulo,
  icono,
  color,
  extra,
  estilo = "blanca",
  className,
  cuerpoClassName,
  children
}: {
  titulo?: ReactNode;
  icono?: NombreIcono | ReactNode;
  color?: ColorEncabezado;
  extra?: ReactNode;
  estilo?: "blanca" | "relieve";
  className?: string;
  cuerpoClassName?: string;
  children?: ReactNode;
}) {
  return (
    <section className={clsx(estilo === "relieve" ? "tarjeta-relieve" : "tarjeta-blanca", "relative min-w-0 overflow-hidden", className)}>
      {titulo !== undefined && (
        <header
          className={clsx(
            "flex items-center justify-between gap-3 border-b px-4 py-4 md:px-[22px]",
            estilo === "relieve" ? "border-[var(--relieve-linea)]" : "border-border",
            color && `encabezado-${color}`
          )}
        >
          <h2 className="flex min-w-0 items-center gap-2.5 font-heading text-[14px] font-bold text-strong">
            {icono && <IconoHundido icono={icono} color={color} />}
            <span className="min-w-0 truncate">{titulo}</span>
          </h2>
          {extra && <div className="shrink-0 text-[12px] font-semibold text-ink-3">{extra}</div>}
        </header>
      )}
      <div className={clsx("px-4 py-[18px] md:px-[22px] md:py-5", cuerpoClassName)}>{children}</div>
    </section>
  );
}

const COLOR_ICONO: Record<ColorEncabezado, string> = {
  menta: "text-ok",
  cyan: "text-info",
  lila: "text-purple",
  morado: "text-purple"
};

// Ícono en círculo hundido. Se exporta para usarlo fuera de un encabezado
// (ej. "PIPELINE ABIERTO" del Inicio).
export function IconoHundido({ icono, color, className }: { icono: NombreIcono | ReactNode; color?: ColorEncabezado; className?: string }) {
  return (
    <span className={clsx("icono-hundido", color ? COLOR_ICONO[color] : "text-navy", className)}>
      {typeof icono === "string" ? <Icono nombre={icono as NombreIcono} size={17} strokeWidth={2.2} /> : icono}
    </span>
  );
}
