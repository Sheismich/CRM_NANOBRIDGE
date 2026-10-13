import { clsx } from "clsx";
import { useTema, type Tema } from "../../lib/tema";
import { Icono } from "../ui/Icono";

// Sol | luna, como en el diseño. `sobreOscuro` = versión para la barra
// azul marino del celular.
const OPCIONES: { valor: Tema; etiqueta: string; icono: "sol" | "luna" }[] = [
  { valor: "claro", etiqueta: "Modo día", icono: "sol" },
  { valor: "oscuro", etiqueta: "Modo oscuro", icono: "luna" }
];

export function SelectorTema({ sobreOscuro = false }: { sobreOscuro?: boolean }) {
  const { tema, elegir } = useTema();
  return (
    <div role="group" aria-label="Tema" className={clsx("inline-flex gap-0.5 rounded-full border p-[3px]", sobreOscuro ? "border-white/12 bg-white/8" : "border-border bg-soft")}>
      {OPCIONES.map((o) => {
        const activo = tema === o.valor;
        return (
          <button
            key={o.valor}
            type="button"
            onClick={() => elegir(o.valor)}
            aria-pressed={activo}
            title={o.etiqueta}
            aria-label={o.etiqueta}
            className={clsx(
              "grid h-[26px] w-[30px] place-items-center rounded-full",
              activo ? (sobreOscuro ? "bg-white/90 text-navy-ink" : "bg-card text-strong shadow-[0_1px_3px_rgba(0,0,0,0.2)]") : sobreOscuro ? "text-white/60" : "text-ink-3"
            )}
          >
            <Icono nombre={o.icono} size={15} />
          </button>
        );
      })}
    </div>
  );
}
