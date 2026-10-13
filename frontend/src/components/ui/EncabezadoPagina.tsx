import type { ReactNode } from "react";
import { clsx } from "clsx";

// Encabezado de cada pantalla (no hay barra de arriba en compu): ceja
// opcional (ej. <Pastilla>"Circuito activo"</Pastilla> · "3 completadas
// ayer"), título grande, subtítulo y botones a la derecha. AppShell pone
// uno solo con el título si la pantalla no trae el suyo.
export function EncabezadoPagina({ ceja, titulo, subtitulo, acciones, className }: { ceja?: ReactNode; titulo: ReactNode; subtitulo?: ReactNode; acciones?: ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-[22px] flex flex-wrap items-end gap-4", className)}>
      <div className="min-w-0 flex-[1_1_18rem]">
        {ceja && <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-3">{ceja}</div>}
        <h1 className="font-heading text-[24px] font-black tracking-[-0.5px] text-strong md:text-[30px]">{titulo}</h1>
        {subtitulo && <p className="mt-1 text-[14px] text-ink-2">{subtitulo}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2.5">{acciones}</div>}
    </div>
  );
}
