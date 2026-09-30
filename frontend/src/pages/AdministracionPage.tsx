import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { AuditoriaAdmin } from "../components/admin/AuditoriaAdmin";
import { IntegracionAdmin } from "../components/admin/IntegracionAdmin";
import { UsuariosAdmin } from "../components/admin/UsuariosAdmin";
import { useAuth } from "../lib/auth-context";

// Administración (PLAN_FRONTEND.md §5, fase 6), cada parte con el permiso
// de su controller: Usuarios y Auditoría para admin/supervisor (solo el
// admin edita usuarios); Integración (eventos pendientes y procesos
// fallidos) solo para el administrador. La pestaña va en ?tab= para poder
// ligarla.
const TABS = [
  { id: "usuarios", label: "Usuarios", soloAdmin: false },
  { id: "auditoria", label: "Auditoría", soloAdmin: false },
  { id: "integracion", label: "Integración con n8n", soloAdmin: true }
] as const;

export function AdministracionPage() {
  const { user } = useAuth();
  const esAdmin = user?.rol === "administrador";
  const [params, setParams] = useSearchParams();
  const visibles = TABS.filter((t) => esAdmin || !t.soloAdmin);
  const tab = visibles.find((t) => t.id === params.get("tab"))?.id ?? "usuarios";

  return (
    <AppShell titulo="Administración">
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
        {visibles.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setParams(t.id === "usuarios" ? {} : { tab: t.id }, { replace: true })}
            className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold ${tab === t.id ? "border-b-2 border-navy text-navy" : "text-ink-3"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "usuarios" && <UsuariosAdmin esAdmin={esAdmin} usuarioActualId={user!.id} />}
      {tab === "auditoria" && <AuditoriaAdmin />}
      {tab === "integracion" && esAdmin && <IntegracionAdmin />}
    </AppShell>
  );
}
