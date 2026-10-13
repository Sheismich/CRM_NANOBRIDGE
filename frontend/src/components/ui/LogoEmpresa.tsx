import { clsx } from "clsx";

// Cuadrito con las iniciales de la empresa (Prospectos, Empresas, la
// ficha): color fijo por empresa, de la paleta de los prototipos.
const COLORES = ["#2a449b", "#23bad3", "#5b2d86", "#15905f", "#c57a0a", "#d63a4a", "#4f6bd6"];

function inicialesEmpresa(nombre: string) {
  const palabras = nombre
    .replace(/\b(S\.?\s?A\.?|de|del|la|las|los|y|C\.?V\.?|R\.?L\.?)\b/gi, " ")
    .split(/\s+/)
    .filter(Boolean);
  return (palabras.length >= 2 ? palabras[0][0] + palabras[1][0] : (palabras[0] ?? nombre).slice(0, 2)).toUpperCase();
}

const TAMANO = {
  chico: "h-[34px] w-[34px] rounded-[10px] text-[11px]",
  normal: "h-[38px] w-[38px] rounded-[11px] text-[13px]",
  grande: "h-12 w-12 rounded-[13px] text-[15px]",
  ficha: "h-[54px] w-[54px] rounded-[15px] text-[18px] md:h-16 md:w-16 md:rounded-[18px] md:text-[21px]"
} as const;

export function LogoEmpresa({ id, nombre, tamano = "normal", className }: { id: number; nombre: string; tamano?: keyof typeof TAMANO; className?: string }) {
  return (
    <span aria-hidden="true" className={clsx("grid shrink-0 place-items-center font-heading font-extrabold text-white", TAMANO[tamano], className)} style={{ background: COLORES[id % COLORES.length] }}>
      {inicialesEmpresa(nombre)}
    </span>
  );
}
