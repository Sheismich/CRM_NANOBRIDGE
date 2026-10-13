import type { ReactNode } from "react";
import { clsx } from "clsx";
import { Icono } from "./Icono";
import { useDialogo } from "./dialogo";

// Detalle que sale por la derecha al dar clic en una fila (documento,
// tarea, empresa, alta de prospecto). En el celular ocupa toda la
// pantalla. `encabezado` es la parte fija de arriba (título, estado,
// botones); `children` se desplaza. Sin `encabezado` va solo `titulo`.
// El contenido solo se monta mientras está abierto.
export function PanelLateral({
  abierto,
  onCerrar,
  titulo,
  encabezado,
  ancho = 560,
  cuerpoClassName,
  children
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo?: ReactNode;
  encabezado?: ReactNode;
  ancho?: number;
  cuerpoClassName?: string;
  children?: ReactNode;
}) {
  const ref = useDialogo(abierto, onCerrar);
  return (
    <dialog
      ref={ref}
      aria-label={typeof titulo === "string" ? titulo : undefined}
      style={{ width: `min(${ancho}px, 100vw)` }}
      className="m-0 ml-auto h-dvh max-h-none max-w-none bg-card p-0 text-ink shadow-[-20px_0_50px_-20px_rgba(0,0,0,0.4)] backdrop:bg-navy-ink/45 backdrop:backdrop-blur-[2px] open:flex open:flex-col"
    >
      {abierto && (
        <>
          <div className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border text-ink-2 hover:text-strong">
              <Icono nombre="cerrar" size={16} />
            </button>
            <div className="min-w-0 flex-1">{encabezado ?? <h2 className="pt-1.5 font-heading text-[16px] font-bold text-strong">{titulo}</h2>}</div>
          </div>
          <div className={clsx("min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-5", cuerpoClassName)}>{children}</div>
        </>
      )}
    </dialog>
  );
}
