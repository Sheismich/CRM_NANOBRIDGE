import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";

export function AppShell({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar titulo={titulo} />
        <div className="flex-1 overflow-auto p-7.5">{children}</div>
      </div>
    </div>
  );
}
