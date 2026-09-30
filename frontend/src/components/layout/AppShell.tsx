import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

// En pantallas anchas (lg) el menú lateral queda fijo; en angostas se
// oculta y se abre como panel sobre el contenido desde el botón de la
// barra superior.
export function AppShell({ titulo, children }: { titulo: string; children: ReactNode }) {
  const [menuAbierto, setMenuAbierto] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <div className="hidden lg:flex">
        <Sidebar />
      </div>

      {menuAbierto && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="shadow-xl">
            <Sidebar onNavigate={() => setMenuAbierto(false)} />
          </div>
          <button type="button" aria-label="Cerrar menú" className="flex-1 bg-navy-ink/40" onClick={() => setMenuAbierto(false)} />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar titulo={titulo} onAbrirMenu={() => setMenuAbierto(true)} />
        <div className="flex-1 overflow-auto p-4 lg:p-7.5">{children}</div>
      </div>
    </div>
  );
}
