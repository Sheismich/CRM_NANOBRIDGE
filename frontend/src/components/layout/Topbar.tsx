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

export function Topbar({ titulo }: { titulo: string }) {
  const { user, logout } = useAuth();

  return (
    <div className="relative flex h-[66px] min-h-[66px] items-center justify-between bg-white px-7.5">
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--grad)] opacity-50" />
      <div className="font-heading text-[19px] font-bold">{titulo}</div>
      {user && (
        <div className="flex items-center gap-4">
          <div className="rounded-full bg-bg px-3.5 py-1.5 text-[11.5px] font-bold text-navy">{ETIQUETA_ROL[user.rol] ?? user.rol}</div>
          <button
            type="button"
            onClick={() => void logout()}
            title="Cerrar sesión"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--grad)] text-[13px] font-bold text-white"
          >
            {iniciales(user.nombre)}
          </button>
        </div>
      )}
    </div>
  );
}
