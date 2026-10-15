import { clsx } from "clsx";
import { Icono } from "./Icono";

// Caja de búsqueda de las listas (Prospectos, Empresas, Contactos,
// Oportunidades, Cotizaciones): lupa + campo. El foco se marca en la caja
// completa y no en el campo de adentro (index.css, .caja-busqueda), para que
// no se vean dos cajas una dentro de otra (revisión de Fabián, 15-oct-2026).
// En el celular ocupa todo el renglón; `className` ajusta el ancho en compu.
export function CajaBusqueda({
  valor,
  onCambiar,
  placeholder,
  etiqueta = "Buscar",
  className
}: {
  valor: string;
  onCambiar: (valor: string) => void;
  placeholder: string;
  etiqueta?: string;
  className?: string;
}) {
  return (
    <label className={clsx("caja-busqueda flex h-10 min-w-0 flex-[1_1_100%] items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-ink-3 md:max-w-[420px] md:flex-[1_1_260px]", className)}>
      <Icono nombre="buscar" size={15} />
      <input aria-label={etiqueta} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-strong outline-none placeholder:text-ink-3" value={valor} onChange={(e) => onCambiar(e.target.value)} />
    </label>
  );
}
