import { NavLink } from "react-router-dom";
import { useAuth } from "../../lib/auth-context";
import { useTema } from "../../lib/tema";
import { NAV_ITEMS, ADMIN_ITEM } from "./nav-items";

// Réplica del sidebar de los mockups: franja de degradado a la izquierda,
// marca arriba, navegación por módulo, Administración separada abajo.
// La visibilidad de Reportes/Administración depende del rol -- mismo
// criterio que aplican ReportesController y UsuariosController del lado
// del backend (esto es solo UX, ver comentario en lib/auth.tsx: el
// backend ya aplica el permiso real).
export function Sidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";

  return (
    <aside className="relative flex h-full w-[264px] min-w-[264px] flex-col overflow-hidden bg-card">
      <div className="absolute left-0 top-0 h-full w-1 bg-[image:var(--grad)]" />

      <div className="px-6 pb-5 pt-7">
        <div className="flex items-center gap-2.5">
          <img src="/logo-n.png" alt="" aria-hidden="true" className="h-8 w-8" />
          <div className="font-display text-[19px] tracking-wide text-navy">NANOBRIDGE</div>
        </div>
      </div>
      <div className="mx-6 mb-4 h-px bg-gradient-to-r from-mint/40 via-cyan/25 to-transparent" />

      <nav className="flex flex-col gap-0.5 px-3.5">
        {NAV_ITEMS.filter((item) => !item.soloAdminSupervisor || esAdminOSupervisor).map((item) => (
          <NavItemLink key={item.to} to={item.to} label={item.label} icon={item.icon} onNavigate={onNavigate} />
        ))}
      </nav>

      {/* Abajo: Administración (solo admin/supervisor) y, para todos, el
          botón de modo claro/oscuro. */}
      <div className="mt-auto px-3.5 pb-5 pt-3.5">
        <div className="mb-2.5 h-px bg-border" />
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            {esAdminOSupervisor && <NavItemLink to={ADMIN_ITEM.to} label={ADMIN_ITEM.label} icon={ADMIN_ITEM.icon} small onNavigate={onNavigate} />}
          </div>
          <BotonTema />
        </div>
      </div>
    </aside>
  );
}

// Sol en modo oscuro (para volver a claro), luna en modo claro.
function BotonTema() {
  const { tema, alternar } = useTema();
  const etiqueta = tema === "oscuro" ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
  return (
    <button type="button" onClick={alternar} aria-label={etiqueta} title={etiqueta} className="shrink-0 rounded-[9px] p-2.5 text-navy hover:bg-bg">
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
        {tema === "oscuro" ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </>
        ) : (
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        )}
      </svg>
    </button>
  );
}

function NavItemLink({ to, label, icon, small, onNavigate }: { to: string; label: string; icon: string; small?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-[9px] px-3.5 py-2.5 font-semibold text-navy ${small ? "text-[12.5px]" : "text-[13.5px]"} ${
          isActive ? "relative bg-gradient-to-r from-mint/15 via-cyan/10 to-transparent" : ""
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute -left-3.5 top-2 bottom-2 w-[3px] rounded bg-[image:var(--grad)]" />}
          <svg width={small ? 16 : 18} height={small ? 16 : 18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
            {icon.split(" M").map((segment, i) => (
              <path key={i} d={i === 0 ? segment : `M${segment}`} />
            ))}
          </svg>
          <span>{label}</span>
        </>
      )}
    </NavLink>
  );
}
