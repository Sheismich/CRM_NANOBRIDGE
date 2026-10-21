import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../../lib/auth-context";
import { tareasPorAtender, useConteosTareas } from "../../lib/tareas";
import { useConteoNotificaciones } from "../../lib/notificaciones";
import { Icono } from "../ui/Icono";
import { itemsVisibles } from "./nav-items";
import { Logo } from "./Logo";
import { SelectorTema } from "./SelectorTema";
import { ETIQUETA_ROL, iniciales } from "./usuario";
import { Tecla } from "../buscador/Buscador";

const ES_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

// Menú lateral de compu (docs/diseno/inicio-aprobado.html): punto menta
// en la opción activa, numerito en Tareas y en Inicio (avisos sin leer:
// la tarjeta "Lo nuevo para ti" vive en el Inicio, opción D del 20-oct),
// abajo el tema y la persona.
// En el celular no se ve: ahí van las barras de BarrasCelular.tsx.
export function Sidebar({ onAbrirBuscador }: { onAbrirBuscador: () => void }) {
  const { user, logout } = useAuth();
  const { data: conteos } = useConteosTareas();
  const porAtender = tareasPorAtender(conteos);
  const avisos = useConteoNotificaciones().data?.no_leidas ?? 0;

  return (
    <aside className="sticky top-0 hidden h-dvh w-[228px] shrink-0 flex-col border-r border-border bg-side px-3.5 py-[22px] md:flex">
      <div className="pb-[26px] pl-2">
        <Logo />
      </div>

      {/* Buscador general (etapa 5, 21-oct-2026): también con Ctrl+K. */}
      <button
        type="button"
        onClick={onAbrirBuscador}
        aria-keyshortcuts={ES_MAC ? "Meta+K" : "Control+K"}
        className="mb-3.5 flex h-10 items-center gap-2 rounded-[11px] border border-border bg-card px-3 text-[13px] text-ink-3 hover:text-strong"
      >
        <Icono nombre="buscar" size={15} />
        <span className="flex-1 text-left">Buscar</span>
        <Tecla>{ES_MAC ? "⌘ K" : "Ctrl K"}</Tecla>
      </button>

      <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
        {itemsVisibles(user?.rol).map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              clsx("flex items-center gap-[11px] rounded-[10px] px-3 py-2.5 text-[14px] font-semibold", isActive ? "bg-navy-bg text-strong" : "text-ink-2 hover:text-strong")
            }
          >
            {({ isActive }) => (
              <>
                <span className={clsx("h-[7px] w-[7px] shrink-0 rounded-full", isActive ? "bg-mint shadow-[0_0_10px_var(--mint)]" : "bg-border")} />
                <span className="min-w-0 truncate">{item.label}</span>
                {item.to === "/tareas" && porAtender > 0 && <Numerito titulo="Vencen hoy o ya vencieron">{porAtender}</Numerito>}
                {item.to === "/" && avisos > 0 && <Numerito titulo="Avisos sin leer">{avisos > 99 ? "99+" : avisos}</Numerito>}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex items-center justify-between px-2 py-2.5 text-[12px] font-bold text-ink-3">
        <span>Tema</span>
        <SelectorTema />
      </div>
      {user && (
        <div className="flex items-center gap-2.5 border-t border-border px-2 pt-3">
          <Avatar nombre={user.nombre} />
          <div className="min-w-0 flex-1">
            <b className="block truncate text-[13px] text-strong">{user.nombre}</b>
            <small className="text-[11px] text-ink-3">{ETIQUETA_ROL[user.rol] ?? user.rol}</small>
          </div>
          <button type="button" onClick={() => void logout()} title="Cerrar sesión" aria-label="Cerrar sesión" className="rounded-[9px] p-2 text-ink-3 hover:bg-soft hover:text-strong">
            <Icono nombre="salir" size={17} />
          </button>
        </div>
      )}
    </aside>
  );
}

function Numerito({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <span className="ml-auto rounded-full bg-cyan px-[7px] py-px text-[11px] font-extrabold text-[#06121a]" title={titulo}>
      {children}
    </span>
  );
}

export function Avatar({ nombre, chico = false }: { nombre: string; chico?: boolean }) {
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--mint),var(--cyan))] font-heading text-[12px] font-extrabold text-[#06121a]",
        chico ? "h-8 w-8" : "h-[34px] w-[34px]"
      )}
    >
      {iniciales(nombre)}
    </span>
  );
}
