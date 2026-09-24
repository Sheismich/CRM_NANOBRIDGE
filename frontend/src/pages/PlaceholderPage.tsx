import { AppShell } from "../components/layout/AppShell";
import { Card } from "../components/ui/Card";

// Fase 1 (Fundacional, PLAN_FRONTEND.md §6) solo cubre login, layout,
// Empresas y Ficha de cliente. El resto de los módulos ya tiene su lugar
// en la navegación -- para no bloquear el resto de las fases con
// pantallas rotas o inexistentes -- pero su contenido real llega después.
export function PlaceholderPage({ titulo, fase }: { titulo: string; fase: string }) {
  return (
    <AppShell titulo={titulo}>
      <Card className="flex flex-col items-center gap-2 p-16 text-center">
        <div className="text-sm font-bold text-ink">{titulo} todavía no está construido</div>
        <div className="max-w-md text-[13px] text-ink-3">Llega en la fase "{fase}" del plan de frontend (PLAN_FRONTEND.md §6). El backend ya expone todo lo que esta pantalla necesita.</div>
      </Card>
    </AppShell>
  );
}
