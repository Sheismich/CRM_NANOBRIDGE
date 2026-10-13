import { clsx } from "clsx";

// N + "NANOBRIDGE". La N de color de día y la clara de noche; `sobreOscuro`
// fuerza la clara (barra azul marino del celular).
export function Logo({ sobreOscuro = false, className }: { sobreOscuro?: boolean; className?: string }) {
  return (
    <div className={clsx("flex items-center gap-2.5", className)}>
      {sobreOscuro ? (
        <img src="/marca/n-claro.svg" alt="" aria-hidden="true" className="w-[30px]" />
      ) : (
        <>
          <img src="/marca/n-color.svg" alt="" aria-hidden="true" className="w-9 dark:hidden" />
          <img src="/marca/n-claro.svg" alt="" aria-hidden="true" className="hidden w-9 dark:block" />
        </>
      )}
      <span className={clsx("font-display tracking-[1.5px]", sobreOscuro ? "text-[18px] text-white" : "text-[20px] text-strong")}>NANOBRIDGE</span>
    </div>
  );
}
