import { useAuth } from "../../lib/auth-context";

const ETIQUETA_ROL: Record<string, string> = {
  administrador: "Administrador",
  supervisor: "Supervisor",
  agente: "Agente"
};

function iniciales(nombre: string) {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export function Topbar({ titulo, onAbrirMenu }: { titulo: string; onAbrirMenu: () => void }) {
  const { user, logout } = useAuth();

  return (
    <div className="relative flex h-[66px] min-h-[66px] items-center justify-between gap-3 bg-white px-4 lg:px-7.5">
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[image:var(--grad)] opacity-50" />
      <div className="flex min-w-0 items-center gap-2">
        <button type="button" aria-label="Abrir menú" onClick={onAbrirMenu} className="-ml-1.5 rounded-[9px] p-1.5 text-navy hover:bg-bg lg:hidden">
          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="truncate font-heading text-[17px] font-bold lg:text-[19px]">{titulo}</div>
      </div>
      {user && (
        <div className="flex items-center gap-4">
          <div className="hidden rounded-full bg-bg px-3.5 py-1.5 sm:block text-[11.5px] font-bold text-navy">{ETIQUETA_ROL[user.rol] ?? user.rol}</div>
          <button
            type="button"
            onClick={() => void logout()}
            title="Cerrar sesión"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[image:var(--grad)] text-[13px] font-bold text-white"
          >
            {iniciales(user.nombre)}
          </button>
        </div>
      )}
    </div>
  );
}
