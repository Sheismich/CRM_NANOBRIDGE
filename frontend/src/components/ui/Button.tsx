import type { ButtonHTMLAttributes } from "react";
import { clsx } from "clsx";

// Botones del rediseño (.btn de docs/diseno/). Los nombres de variante son
// los de antes para que las pantallas viejas sigan compilando.
type Variant = "primary" | "outline" | "ghost" | "exito" | "peligro" | "aprobar" | "rechazar";

const VARIANTS: Record<Variant, string> = {
  // Degradado azul → morado ("+ Nueva tarea", "Subir documento").
  primary: "bg-[image:var(--grad-boton)] text-white shadow-[0_10px_22px_-12px_rgba(42,68,155,0.8)]",
  // Tarjeta con borde ("Descargar lote", "Nueva versión").
  outline: "border border-border bg-card text-strong hover:border-navy/40",
  ghost: "text-ink-2 hover:bg-soft",
  // Verde menta para confirmar (ej. filas de importación).
  exito: "bg-mint text-navy-ink",
  // Acciones que desactivan algo (empresa, contacto).
  peligro: "text-danger hover:bg-danger-bg",
  // Aprobar / Rechazar del panel de Documentos.
  aprobar: "bg-[linear-gradient(120deg,#13a36b,#1593ab)] text-white shadow-[0_10px_20px_-10px_rgba(19,163,107,0.8)]",
  rechazar: "border border-danger/25 bg-danger-bg text-danger"
};

export function Button({ variant = "primary", className, disabled, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] px-4 py-2.5 text-[13.5px] font-extrabold transition-opacity",
        VARIANTS[variant],
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
        className
      )}
      disabled={disabled}
      {...rest}
    />
  );
}
