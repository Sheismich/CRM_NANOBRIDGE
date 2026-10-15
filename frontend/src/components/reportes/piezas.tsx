import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import { ApiError, api } from "../../lib/api";

// Piezas de Reportes (docs/diseno/reportes.html): la tarjeta de cada
// gráfica, con su frase arriba y dos datos al pie, y el botón de CSV.

export function TarjetaReporte({
  titulo,
  subtitulo,
  extra,
  frase,
  pie,
  pieDerecha,
  className,
  children
}: {
  titulo: string;
  subtitulo?: string;
  extra?: ReactNode;
  frase?: ReactNode;
  pie?: ReactNode;
  pieDerecha?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={clsx("tarjeta-blanca min-w-0 overflow-hidden !rounded-[18px]", className)}>
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-3.5 md:px-[18px]">
        <h2 className="min-w-0 truncate font-heading text-[14px] font-extrabold text-strong">
          {titulo}
          {subtitulo && <small className="ml-2 font-sans text-[12px] font-semibold text-ink-3">{subtitulo}</small>}
        </h2>
        {extra && <div className="ml-auto shrink-0">{extra}</div>}
      </header>
      {frase && <p className="mx-4 mt-3.5 rounded-[10px] border-l-[3px] border-navy bg-soft px-3.5 py-2.5 text-[13px] text-navy md:mx-[18px]">{frase}</p>}
      <div className="px-4 py-4 md:px-[18px]">
        {children}
        {(pie || pieDerecha) && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-border pt-3 text-[12.5px] text-ink-2">
            <span>{pie}</span>
            {pieDerecha && <span className="font-bold">{pieDerecha}</span>}
          </div>
        )}
      </div>
    </section>
  );
}

// GET /reportes/export/:reporte con los mismos filtros que la tarjeta. El
// backend ya pone el BOM para que Excel respete los acentos.
export function BotonCsv({ reporte, filtros }: { reporte: string; filtros: Record<string, string | number | undefined> }) {
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function bajar() {
    setOcupado(true);
    setError(null);
    try {
      const qs = new URLSearchParams(Object.entries(filtros).filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== "").map(([k, v]) => [k, String(v)])).toString();
      await api.descargar(`/api/v1/reportes/export/${reporte}${qs ? `?${qs}` : ""}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo descargar");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void bajar()}
      disabled={ocupado}
      title={error ?? `Descargar en CSV`}
      className={clsx("inline-flex items-center gap-1 rounded-[9px] border px-2.5 py-1 text-[12px] font-extrabold", error ? "border-danger/40 text-danger" : "border-border text-info hover:border-info", ocupado && "opacity-50")}
    >
      <Icono nombre="descargar" size={13} /> {error ? "Reintentar" : "CSV"}
    </button>
  );
}
