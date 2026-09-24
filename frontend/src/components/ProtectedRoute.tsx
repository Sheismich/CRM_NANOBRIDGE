import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth-context";
import type { Rol } from "../types";

// El backend ya aplica los permisos reales -- ver lib/auth.tsx: esto es
// solo para no mostrarle a un agente una pantalla que va a fallarle con
// 403 (PLAN_FRONTEND.md §4).
export function ProtectedRoute({ children, soloRoles }: { children: ReactNode; soloRoles?: Rol[] }) {
  const { user, status } = useAuth();

  if (status === "loading") return <div className="flex h-screen items-center justify-center text-sm text-ink-2">Cargando…</div>;
  if (status === "anonymous" || !user) return <Navigate to="/login" replace />;
  if (soloRoles && !soloRoles.includes(user.rol)) return <Navigate to="/" replace />;

  return <>{children}</>;
}
