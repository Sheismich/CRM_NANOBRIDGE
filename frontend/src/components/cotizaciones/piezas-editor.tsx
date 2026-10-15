import type { ReactNode } from "react";
import { clsx } from "clsx";

// Piezas del editor de cotizaciones (docs/diseno/cotizaciones.html, opción
// D): las usan EditorCotizacion (pasos 1 y 2) y CotizacionForm en modo
// editor (pasos 3 y 4).

const PASOS = ["Empresa", "Oportunidad", "Partidas", "Revisar y enviar"] as const;
export type Paso = 1 | 2 | 3 | 4;

export function Pasos({ actual }: { actual: Paso }) {
  return (
    <ol className="mb-[18px] flex flex-wrap items-center gap-2">
      {PASOS.map((nombre, i) => {
        const n = i + 1;
        const estado = n < actual ? "hecho" : n === actual ? "actual" : "falta";
        return (
          <li key={nombre} className="flex items-center gap-2" aria-current={estado === "actual" ? "step" : undefined}>
            {i > 0 && <s className="h-0.5 w-3 bg-border no-underline md:w-10" aria-hidden="true" />}
            <span className={clsx("flex items-center gap-2 text-[13px] font-bold", estado === "actual" ? "text-strong" : estado === "hecho" ? "text-ink-2" : "text-ink-3")}>
              <i
                className={clsx(
                  "grid h-[26px] w-[26px] place-items-center rounded-full text-[12px] font-extrabold not-italic",
                  estado === "actual" ? "bg-[linear-gradient(135deg,var(--mint),var(--cyan))] text-[#06121a]" : estado === "hecho" ? "bg-ok-bg text-ok" : "border-[1.5px] border-border"
                )}
              >
                {estado === "hecho" ? "✓" : n}
              </i>
              <span className={clsx(estado !== "actual" && "max-md:hidden")}>{nombre}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Tarjeta del editor: título en negritas con algo a la derecha (ej. "+ Agregar partida").
export function TarjetaEditor({ titulo, extra, children, className }: { titulo: ReactNode; extra?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx("tarjeta-blanca overflow-hidden !rounded-[18px]", className)}>
      <h3 className="flex items-center gap-2 border-b border-border px-4 py-3.5 font-heading text-[14px] font-extrabold text-strong md:px-[18px]">
        {titulo}
        {extra && <span className="ml-auto">{extra}</span>}
      </h3>
      {children}
    </section>
  );
}

// Lo ya elegido en "Para quién" (empresa, oportunidad), con "Cambiar".
export function RenglonElegido({ icono, titulo, detalle, onCambiar }: { icono: ReactNode; titulo: ReactNode; detalle?: ReactNode; onCambiar?: () => void }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0 md:px-[18px]">
      {icono}
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[14px] text-strong">{titulo}</b>
        {detalle && <small className="block truncate text-[12px] text-ink-3">{detalle}</small>}
      </div>
      {onCambiar && (
        <button type="button" onClick={onCambiar} className="text-[12px] font-extrabold text-info hover:underline">
          Cambiar
        </button>
      )}
    </div>
  );
}

// Columna derecha: el resumen con el total (se queda fijo al desplazarse en compu).
export function ResumenEditor({ children }: { children: ReactNode }) {
  return (
    <aside className="tarjeta-blanca overflow-hidden !rounded-[18px] pb-4 lg:sticky lg:top-5">
      <h3 className="border-b border-border px-[18px] py-3.5 font-heading text-[14px] font-extrabold text-strong">Resumen</h3>
      {children}
    </aside>
  );
}

export function RenglonResumen({ etiqueta, children, grande = false }: { etiqueta: ReactNode; children: ReactNode; grande?: boolean }) {
  return (
    <div className={clsx("flex items-center justify-between gap-2.5 px-[18px] text-[13px] text-ink-2", grande ? "my-1.5 border-y border-border bg-soft py-3.5" : "py-[9px]")}>
      <span className={clsx(grande && "font-extrabold text-strong")}>{etiqueta}</span>
      {children}
    </div>
  );
}

export function TotalGrande({ children }: { children: ReactNode }) {
  return <b className="mono bg-[linear-gradient(90deg,var(--navy),var(--purple))] bg-clip-text font-display text-[28px] font-normal text-transparent dark:bg-[linear-gradient(90deg,var(--mint),var(--cyan))]">{children}</b>;
}

export function NotaEditor({ children }: { children: ReactNode }) {
  return <div className="mx-[18px] my-2.5 rounded-[10px] bg-info-bg px-3 py-2.5 text-[12px] font-semibold text-info">ⓘ {children}</div>;
}
