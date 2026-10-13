import type { ReactNode } from "react";
import { clsx } from "clsx";
import { MarcaDeAgua } from "./MarcaDeAgua";

// Franja azul de arriba (Inicio aprobado; también Administración): degradado
// navy → morado, la N clara de marca de agua, una ceja en mayúsculas,
// chips (ej. "Automatización activa"), fecha a la derecha, saludo y los
// números grandes (<Kpi>) como children. Igual en modo día y noche.
export function Franja({
  ceja,
  chips,
  fecha,
  titulo,
  subtitulo,
  children,
  className
}: {
  ceja?: ReactNode;
  chips?: ReactNode;
  fecha?: ReactNode;
  titulo: ReactNode;
  subtitulo?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={clsx("franja px-4 py-[22px] md:px-10 md:pb-9 md:pt-[34px]", className)}>
      <MarcaDeAgua sobreOscuro girada={false} className="-right-[60px] -top-[30px] w-[240px] md:-right-[50px] md:-top-[50px] md:w-[380px]" />
      {(ceja || chips || fecha) && (
        <div className="relative z-[1] flex flex-wrap items-center gap-3">
          {ceja && <span className="font-heading text-[11px] font-extrabold uppercase tracking-[3px] text-mint">{ceja}</span>}
          {chips}
          {fecha && <span className="w-full text-[13px] text-white/60 md:ml-auto md:w-auto">{fecha}</span>}
        </div>
      )}
      <h1 className="relative z-[1] mt-3 font-heading text-[26px] font-black md:text-[34px]">{titulo}</h1>
      {subtitulo && <p className="relative z-[1] mt-1 text-white/70">{subtitulo}</p>}
      {children && <div className="relative z-[1] mt-[30px] grid grid-cols-2 gap-y-[18px] md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] md:gap-y-[22px]">{children}</div>}
    </section>
  );
}

// Un número grande de la franja. `resaltado` lo pinta con degradado menta →
// cyan (la tasa de respuesta del Inicio). `detalle` va en menta abajo
// ("+12 hoy", "septiembre: 8.2%").
export function Kpi({ valor, etiqueta, detalle, resaltado }: { valor: ReactNode; etiqueta: ReactNode; detalle?: ReactNode; resaltado?: boolean }) {
  return (
    <div className="pr-2.5 md:mr-[22px] md:border-r md:border-white/15 md:pr-[22px] md:last:mr-0 md:last:border-r-0">
      <div className={clsx("mono font-display text-[42px] leading-none md:text-[58px]", resaltado && "franja-numero-resaltado")}>{valor}</div>
      <div className="mt-2 text-[13px] font-semibold text-white/70">{etiqueta}</div>
      {detalle && <div className="mt-[3px] text-[12px] font-bold text-mint">{detalle}</div>}
    </div>
  );
}

// Chip "● Automatización activa" de la franja.
export function ChipVivo({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/30 bg-mint/12 px-2.5 py-1 text-[12px] font-bold text-mint">
      <span className="punto-vivo" />
      {children}
    </span>
  );
}
