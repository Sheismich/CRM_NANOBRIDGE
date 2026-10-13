import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import type { Tono } from "../ui/tonos";
import { iniciales } from "../layout/usuario";
import { api } from "../../lib/api";
import { cuando } from "../../lib/documentos";
import { plural } from "../../lib/formato";
import type { Paginated, Rol, Usuario } from "../../types";

// "Equipo y roles" de Administración: cuántas personas tiene cada nivel de
// acceso y quién está activo, con su último acceso (migración 030). Dar de
// alta, editar o desactivar se hace en el panel de usuarios de siempre
// (`onAdministrar`); el supervisor solo consulta.

const NIVELES: { rol: Exclude<Rol, "sistema">; nombre: string; que: string; punto: string; tono: Tono }[] = [
  { rol: "administrador", nombre: "Administrador", que: "Ve y cambia todo, incluida esta pantalla", punto: "bg-purple", tono: "navy" },
  { rol: "supervisor", nombre: "Supervisor", que: "Ve a todo el equipo, clasifica respuestas y reasigna", punto: "bg-cyan", tono: "info" },
  { rol: "agente", nombre: "Agente", que: "Solo sus empresas, tareas y oportunidades", punto: "bg-mint", tono: "ok" }
];

export function EquipoRoles({ puedeEditar, onAdministrar }: { puedeEditar: boolean; onAdministrar: () => void }) {
  const ahora = new Date();
  const { data, isPending, isError } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    staleTime: 60_000
  });
  const personas = (data?.data ?? []).filter((u) => u.rol !== "sistema");
  const cuantos = (rol: Rol) => personas.filter((u) => u.rol === rol).length;

  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[rgba(91,45,134,0.12)] text-purple">
          <Icono d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M12 11a2.5 2.5 0 1 0 0-.001 M8.5 17c0-1.9 1.6-3.5 3.5-3.5s3.5 1.6 3.5 3.5" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-extrabold text-strong">Equipo y roles</h2>
          <p className="text-[12.5px] text-ink-3">Quién tiene acceso y qué puede hacer</p>
        </div>
        <button type="button" onClick={onAdministrar} title={puedeEditar ? "Administrar usuarios" : "Ver usuarios"} aria-label={puedeEditar ? "Administrar usuarios" : "Ver usuarios"} className="grid h-9 w-9 place-items-center rounded-[10px] border border-border text-navy hover:border-navy/40">
          <Icono d="M9 8a3 3 0 1 0 0-.001 M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M19 8v6 M16 11h6" size={17} />
        </button>
      </header>
      <div className="px-4 py-4 md:px-5">
        <h3 className="mb-2 font-heading text-[11px] font-extrabold uppercase tracking-[2px] text-ink-3">Niveles de acceso</h3>
        <ul className="flex flex-col gap-2">
          {NIVELES.map((n) => (
            <li key={n.rol} className="flex items-center gap-3 rounded-[12px] bg-soft px-3 py-2.5">
              <span className={clsx("h-2.5 w-2.5 shrink-0 rounded-full", n.punto)} />
              <div className="min-w-0 flex-1">
                <b className="block text-[13.5px] text-strong">{n.nombre}</b>
                <small className="block text-[11.5px] text-ink-3">{n.que}</small>
              </div>
              <span className="shrink-0 rounded-full border border-border bg-card px-2.5 py-0.5 text-[11.5px] font-bold text-ink-2">{data ? plural(cuantos(n.rol), "usuario", "usuarios") : "…"}</span>
            </li>
          ))}
        </ul>

        <h3 className="mb-1 mt-5 font-heading text-[11px] font-extrabold uppercase tracking-[2px] text-ink-3">Usuarios activos</h3>
        {isPending && <p className="py-2 text-[13px] text-ink-3">Cargando…</p>}
        {isError && <p className="py-2 text-[13px] text-danger">No se pudieron cargar los usuarios.</p>}
        <ul>
          {personas.map((u) => {
            const nivel = NIVELES.find((n) => n.rol === u.rol);
            const reciente = u.ultimo_acceso_en && ahora.getTime() - new Date(u.ultimo_acceso_en).getTime() < 15 * 60_000;
            return (
              <li key={u.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--mint),var(--cyan))] font-heading text-[13px] font-extrabold text-[#06121a]">{iniciales(u.nombre)}</span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[13.5px] text-strong">{u.nombre}</b>
                  <small className="block truncate text-[11.5px] text-ink-3">{u.correo}</small>
                  <small className={clsx("block text-[11.5px]", reciente ? "font-bold text-ok" : "text-ink-3")}>
                    {reciente && "● "}
                    {u.ultimo_acceso_en ? `Último acceso: ${cuando(u.ultimo_acceso_en, ahora).toLowerCase()}` : "Todavía no entra (desde el 12 oct)"}
                  </small>
                </div>
                {nivel && <Pastilla tono={nivel.tono}>{nivel.nombre}</Pastilla>}
              </li>
            );
          })}
        </ul>
        {puedeEditar && (
          <button type="button" onClick={onAdministrar} className="mt-3 flex w-full items-center justify-center gap-2 rounded-[12px] border border-dashed border-navy/40 py-3 text-[13.5px] font-bold text-navy hover:bg-navy-bg">
            <Icono d="M9 8a3 3 0 1 0 0-.001 M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6 M19 8v6 M16 11h6" size={17} /> Nuevo usuario
          </button>
        )}
      </div>
    </section>
  );
}
