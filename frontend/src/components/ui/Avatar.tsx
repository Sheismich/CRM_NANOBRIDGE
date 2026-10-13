import { clsx } from "clsx";
import { iniciales } from "../layout/usuario";

// Círculo con las iniciales de una persona (responsable de una empresa,
// contacto). Sin nombre es el "?" punteado de "Sin responsable".
export function Avatar({ nombre, className }: { nombre: string | null | undefined; className?: string }) {
  if (!nombre) {
    return (
      <span aria-hidden="true" className={clsx("inline-grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full border border-dashed border-ink-3 bg-soft font-heading text-[10px] font-extrabold text-ink-3", className)}>
        ?
      </span>
    );
  }
  return (
    <span aria-hidden="true" className={clsx("inline-grid h-[26px] w-[26px] shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--mint),var(--cyan))] font-heading text-[10px] font-extrabold text-navy-ink", className)}>
      {iniciales(nombre)}
    </span>
  );
}
