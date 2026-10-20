import { NavLink, useLocation } from "react-router-dom";
import { clsx } from "clsx";
import { useAuth } from "../../lib/auth-context";
import { tareasPorAtender, useConteosTareas } from "../../lib/tareas";
import { useConteoNotificaciones } from "../../lib/notificaciones";
import { Icono } from "../ui/Icono";
import { useDialogo } from "../ui/dialogo";
import { itemsVisibles, type NavItem } from "./nav-items";
import { Logo } from "./Logo";
import { SelectorTema } from "./SelectorTema";
import { Avatar } from "./Sidebar";
import { ETIQUETA_ROL } from "./usuario";

// Celular (menos de 768 px): barra azul marino arriba y barra de
// navegación abajo, tipo app, con los 4 accesos marcados `celular` en
// nav-items.ts + "Más" (los demás módulos, la persona y cerrar sesión).

export function BarraSuperiorCelular({ onAbrirMas }: { onAbrirMas: () => void }) {
  const { user } = useAuth();
  return (
    <div className="sticky top-0 z-30 flex items-center gap-2.5 border-b border-white/8 bg-[#101733] px-4 py-3 text-white md:hidden">
      <Logo sobreOscuro />
      <div className="ml-auto flex items-center gap-1">
        <SelectorTema sobreOscuro />
      </div>
      {user && (
        <button type="button" onClick={onAbrirMas} aria-label="Tu cuenta y más opciones" className="ml-2">
          <Avatar nombre={user.nombre} chico />
        </button>
      )}
    </div>
  );
}

export function BarraNavegacion({ onAbrirMas }: { onAbrirMas: () => void }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const { data: conteos } = useConteosTareas();
  const porAtender = tareasPorAtender(conteos);
  // Avisos sin leer: el numerito va en Inicio, donde está "Lo nuevo para ti".
  const avisos = useConteoNotificaciones().data?.no_leidas ?? 0;
  const items = itemsVisibles(user?.rol);
  const principales = items.filter((i) => i.celular);
  // "Más" se marca cuando la pantalla abierta es una de las que viven ahí.
  const enMas = items.some((i) => !i.celular && pathname.startsWith(i.to));

  return (
    <nav aria-label="Navegación" className="barra-celular fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-side px-1 pt-1.5 md:hidden">
      {principales.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === "/"} className={({ isActive }) => claseBoton(isActive)}>
          {({ isActive }) => (
            <>
              <IconoBarra item={item} activo={isActive} numerito={item.to === "/tareas" ? porAtender : item.to === "/" ? avisos : 0} />
              {item.corto ?? item.label}
            </>
          )}
        </NavLink>
      ))}
      <button type="button" onClick={onAbrirMas} className={claseBoton(enMas)}>
        <span className={clsx("grid h-[26px] w-[26px] place-items-center rounded-[8px]", enMas && "bg-mint/12 text-ok")}>
          <Icono nombre="puntos" size={20} strokeWidth={3} />
        </span>
        Más
      </button>
    </nav>
  );
}

function claseBoton(activo: boolean) {
  return clsx("flex flex-col items-center gap-[3px] py-1 text-[10.5px] font-bold", activo ? "text-strong" : "text-ink-3");
}

function IconoBarra({ item, activo, numerito }: { item: NavItem; activo: boolean; numerito: number }) {
  return (
    <span className={clsx("relative grid h-[26px] w-[26px] place-items-center rounded-[8px]", activo && "bg-mint/12 text-ok")}>
      <Icono d={item.icon} size={19} />
      {numerito > 0 && <em className="absolute -right-2.5 -top-1.5 rounded-full bg-cyan px-[5px] py-px text-[9px] font-extrabold not-italic text-[#06121a]">{numerito > 99 ? "99+" : numerito}</em>}
    </span>
  );
}

// Hoja que sube desde abajo con lo que no cabe en la barra.
export function HojaMas({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const { user, logout } = useAuth();
  const ref = useDialogo(abierta, onCerrar);
  const resto = itemsVisibles(user?.rol).filter((i) => !i.celular);

  return (
    <dialog ref={ref} aria-label="Más opciones" className="m-0 mt-auto w-full max-w-none rounded-t-[22px] border-t border-border bg-side p-0 text-ink backdrop:bg-navy-ink/45 md:hidden">
      {abierta && (
        <div className="px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
          {user && (
            <div className="mb-3 flex items-center gap-2.5 rounded-[14px] bg-soft px-3 py-2.5">
              <Avatar nombre={user.nombre} />
              <div className="min-w-0 flex-1">
                <b className="block truncate text-[13px] text-strong">{user.nombre}</b>
                <small className="text-[11px] text-ink-3">{ETIQUETA_ROL[user.rol] ?? user.rol}</small>
              </div>
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            {resto.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onCerrar}
                className={({ isActive }) =>
                  clsx("flex flex-col items-center gap-1.5 rounded-[14px] border px-1 py-3 text-center text-[12px] font-bold", isActive ? "border-mint bg-mint/10 text-strong" : "border-border text-ink-2")
                }
              >
                <Icono d={item.icon} size={20} />
                {item.label}
              </NavLink>
            ))}
          </div>
          <button type="button" onClick={() => void logout()} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[12px] border border-border py-3 text-[13.5px] font-bold text-danger">
            <Icono nombre="salir" size={17} />
            Cerrar sesión
          </button>
        </div>
      )}
    </dialog>
  );
}

