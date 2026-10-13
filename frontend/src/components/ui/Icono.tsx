import { ICONOS, type NombreIcono } from "./iconos";

// Ícono de trazo. Con `nombre` usa uno de ICONOS (iconos.ts); con `d`, el
// trazo que se le pase.
export function Icono({ nombre, d, size = 18, strokeWidth = 2, className }: { nombre?: NombreIcono; d?: string; size?: number; strokeWidth?: number; className?: string }) {
  const trazo = d ?? (nombre ? ICONOS[nombre] : "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {trazo.split(" M").map((segmento, i) => (
        <path key={i} d={i === 0 ? segmento : `M${segmento}`} />
      ))}
    </svg>
  );
}
