import { useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AppShell } from "../components/layout/AppShell";
import { MiDia } from "../components/tareas/MiDia";
import { VerTodas, type Alcance } from "../components/tareas/VerTodas";
import { NuevaTareaForm } from "../components/tareas/NuevaTareaForm";
import { Button } from "../components/ui/Button";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { Icono } from "../components/ui/Icono";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { plural } from "../lib/formato";
import { fechaLarga } from "../lib/mi-dia";
import { useColaClasificacion, useConteosTareas, useListaTareas } from "../lib/tareas";
import type { Paginated, Usuario } from "../types";

// Tareas del rediseño (docs/diseno/tareas.html): "Mi día" (opción 3) por
// omisión y "Ver todas" (opción 6, lista + detalle). En la URL:
// ?vista=todas abre Ver todas y ?tab=cola la cola de clasificación (liga
// del Inicio). La cola y "Del equipo" son solo de administrador y
// supervisor, los únicos que clasifican y asignan.
export function TareasPage() {
  const { user } = useAuth();
  const esAdminOSupervisor = user?.rol === "administrador" || user?.rol === "supervisor";
  const [params, setParams] = useSearchParams();
  const [creando, setCreando] = useState(false);

  const enCola = esAdminOSupervisor && params.get("tab") === "cola";
  const vista = enCola || params.get("vista") === "todas" ? "todas" : "mi-dia";
  const alcanceUrl = params.get("alcance");
  const alcance: Alcance = enCola ? "cola" : esAdminOSupervisor && (alcanceUrl === "todas" || alcanceUrl === "sin_asignar") ? alcanceUrl : "mias";

  const misAbiertas = useListaTareas({ responsableId: user?.id });
  const conteos = useConteosTareas();
  const cola = useColaClasificacion(1, esAdminOSupervisor);
  // GET /usuarios solo lo pueden llamar admin/supervisor (avatares,
  // reasignar y elegir responsable al crear). La cuenta "sistema" no
  // trabaja tareas.
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor,
    staleTime: 5 * 60_000
  });
  const personas = usuarios?.data.filter((u) => u.rol !== "sistema");

  const nAbiertas = misAbiertas.data?.tareas.length ?? 0;
  const c = conteos.data;
  const nCola = cola.data?.data.length ?? 0;

  function irA(nueva: { vista?: "mi-dia" | "todas"; alcance?: Alcance }) {
    const v = nueva.vista ?? vista;
    const a = nueva.alcance ?? (nueva.vista === "mi-dia" ? "mias" : alcance);
    if (v === "mi-dia") setParams({}, { replace: true });
    else if (a === "cola") setParams({ tab: "cola" }, { replace: true });
    else setParams(a === "mias" ? { vista: "todas" } : { vista: "todas", alcance: a }, { replace: true });
  }

  const encabezado = (
    <EncabezadoPagina
      ceja={
        vista === "mi-dia" &&
        c && (
          <>
            <Pastilla tono={c.vencidas > 0 ? "danger" : "ok"} punto mayusculas>
              {c.vencidas > 0 ? `${plural(c.vencidas, "vencida", "vencidas")}` : "Al día"}
            </Pastilla>
            {c.cerradas_ayer > 0 && <span>· {plural(c.cerradas_ayer, "completada", "completadas")} ayer</span>}
          </>
        )
      }
      titulo={vista === "mi-dia" ? "Mi día" : "Tareas"}
      subtitulo={
        vista === "mi-dia"
          ? `${fechaLarga(new Date())} · lo siguiente que toca, primero.`
          : [plural(nAbiertas, "abierta tuya", "abiertas tuyas"), c && c.vencidas > 0 && plural(c.vencidas, "vencida", "vencidas"), esAdminOSupervisor && nCola > 0 && `${nCola} por clasificar`].filter(Boolean).join(" · ")
      }
      acciones={
        <>
          <div role="tablist" aria-label="Vista" className="inline-flex rounded-[13px] border border-border bg-card p-1">
            <BotonVista activo={vista === "mi-dia"} onClick={() => irA({ vista: "mi-dia" })} icono="reloj">
              Mi día
            </BotonVista>
            <BotonVista activo={vista === "todas"} onClick={() => irA({ vista: "todas" })} icono="menu">
              Ver todas
              {nAbiertas > 0 && <span className="ml-1.5 rounded-full bg-info-bg px-1.5 text-[11px] font-extrabold text-info">{nAbiertas}</span>}
            </BotonVista>
          </div>
          <Button onClick={() => setCreando(true)}>
            <Icono nombre="mas" size={17} /> Nueva tarea
          </Button>
        </>
      }
    />
  );

  return (
    <AppShell titulo="Tareas" encabezado={encabezado}>
      {user &&
        (vista === "mi-dia" ? (
          <MiDia usuarioId={user.id} esAdminOSupervisor={esAdminOSupervisor} onIrACola={() => irA({ vista: "todas", alcance: "cola" })} />
        ) : (
          <VerTodas usuarioId={user.id} esAdminOSupervisor={esAdminOSupervisor} usuarios={personas} alcance={alcance} onAlcance={(a) => irA({ vista: "todas", alcance: a })} />
        ))}

      <PanelLateral abierto={creando} onCerrar={() => setCreando(false)} titulo="Nueva tarea" cuerpoClassName="!p-0">
        {user && <NuevaTareaForm usuarioActualId={user.id} usuarios={esAdminOSupervisor ? personas : undefined} onDone={() => setCreando(false)} />}
      </PanelLateral>
    </AppShell>
  );
}

function BotonVista({ activo, onClick, icono, children }: { activo: boolean; onClick: () => void; icono: "reloj" | "menu"; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activo}
      onClick={onClick}
      className={clsx("inline-flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-bold", activo ? "bg-navy-bg text-strong" : "text-ink-2 hover:text-strong")}
    >
      <Icono nombre={icono} size={15} />
      {children}
    </button>
  );
}
