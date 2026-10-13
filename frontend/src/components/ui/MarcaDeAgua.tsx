import { clsx } from "clsx";

// La N de NANOBRIDGE detrás del contenido. Dentro de una tarjeta normal
// cambia sola con el tema: N de color a .09 de día, N clara a .12 de
// noche (index.css, .marca-agua). Sobre la franja azul (`sobreOscuro`)
// siempre es la clara. El padre necesita `relative overflow-hidden`;
// tamaño y posición van en className (ej. "w-[340px] -right-10 -bottom-16").
export function MarcaDeAgua({ className, sobreOscuro = false, girada = true }: { className?: string; sobreOscuro?: boolean; girada?: boolean }) {
  const clases = clsx("marca-agua", girada && "-rotate-8", className);
  if (sobreOscuro) {
    return <img src="/marca/n-claro.svg" alt="" aria-hidden="true" className={clsx(clases, "!opacity-[.12]")} />;
  }
  return (
    <>
      <img src="/marca/n-color.svg" alt="" aria-hidden="true" className={clsx(clases, "marca-agua-dia")} />
      <img src="/marca/n-claro.svg" alt="" aria-hidden="true" className={clsx(clases, "marca-agua-noche")} />
    </>
  );
}
