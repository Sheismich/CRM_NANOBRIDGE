import type { ReactNode } from "react";
import { Icono } from "./Icono";
import { useDialogo } from "./dialogo";

// Ventana al centro para pedir algo antes de seguir: motivo de rechazo
// (Documentos, Cotizaciones), motivo de pérdida, confirmar ganar.
// `acciones` son los botones de abajo (Cancelar / Rechazar...). El
// contenido solo se monta mientras está abierta, así que un formulario
// adentro empieza vacío cada vez.
export function Modal({
  abierto,
  onCerrar,
  titulo,
  descripcion,
  acciones,
  ancho = 480,
  children
}: {
  abierto: boolean;
  onCerrar: () => void;
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
  ancho?: number;
  children?: ReactNode;
}) {
  const ref = useDialogo(abierto, onCerrar);
  return (
    <dialog
      ref={ref}
      aria-label={typeof titulo === "string" ? titulo : undefined}
      style={{ width: `min(${ancho}px, calc(100vw - 24px))` }}
      className="m-auto max-h-[calc(100dvh-24px)] max-w-none rounded-[20px] border border-border bg-card p-0 text-ink shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)] backdrop:bg-navy-ink/45 backdrop:backdrop-blur-[2px]"
    >
      {abierto && (
        <div className="flex max-h-[calc(100dvh-24px)] flex-col">
          <div className="flex items-start gap-3 px-5 pb-2 pt-5">
            <div className="min-w-0 flex-1">
              <h2 className="font-heading text-[17px] font-extrabold text-strong">{titulo}</h2>
              {descripcion && <p className="mt-1 text-[13px] text-ink-2">{descripcion}</p>}
            </div>
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-soft hover:text-strong">
              <Icono nombre="cerrar" size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
          {acciones && <div className="flex flex-wrap justify-end gap-2.5 border-t border-border px-5 py-4">{acciones}</div>}
        </div>
      )}
    </dialog>
  );
}
