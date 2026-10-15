import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import { Tarjeta } from "../ui/Tarjeta";
import { api } from "../../lib/api";
import { formatoFechaHora } from "../../lib/formato";
import { estaVencida, venceHoy } from "../../lib/tareas";
import type { Paginated, Tarea } from "../../types";

const MAXIMO = 5;

// Tarjeta "Tareas" de la ficha (docs/diseno/empresas.html, columna
// derecha): lo que falta hacer con esta empresa, lo más urgente primero.
// GET /tareas?empresaId= desde el 15-oct-2026; filtra por UN estado, así que
// abiertas = pendiente + en progreso. Un agente solo ve las suyas (el
// backend lo limita). Empieza con ["tareas"]: crear o cerrar una la refresca.
export function TareasEmpresa({ empresaId, nombreDe, onNueva }: { empresaId: number; nombreDe: (id: number | null) => string | null; onNueva: () => void }) {
  const { data: tareas = [], isPending } = useQuery({
    queryKey: ["tareas", "empresa", empresaId],
    queryFn: async () => {
      const paginas = await Promise.all(
        (["pendiente", "en_progreso"] as const).map((estado) => api.get<Paginated<Tarea>>("/api/v1/tareas", { empresaId, estado, limit: 100 }))
      );
      return paginas
        .flatMap((p) => p.data)
        .sort((a, b) => (a.fecha_limite ?? "9999").localeCompare(b.fecha_limite ?? "9999"));
    }
  });

  return (
    <Tarjeta
      titulo="Tareas"
      icono="checkCirculo"
      color="cyan"
      extra={
        <span className="flex items-center gap-3">
          {tareas.length > 0 && <span className="text-ink-3">{tareas.length === 1 ? "1 pendiente" : `${tareas.length} pendientes`}</span>}
          <button type="button" className="font-bold text-navy hover:underline" onClick={onNueva}>
            + Nueva
          </button>
        </span>
      }
    >
      {isPending && <div className="text-[13px] text-ink-3">Cargando…</div>}
      {!isPending && tareas.length === 0 && <div className="text-[13px] text-ink-3">Nada pendiente con esta empresa.</div>}
      {tareas.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {tareas.slice(0, MAXIMO).map((t) => {
            const vencida = estaVencida(t);
            const hoy = venceHoy(t);
            const quien = nombreDe(t.responsable_id) ?? (t.responsable_id == null ? "Sin asignar" : null);
            return (
              <li key={t.id} className="flex items-start gap-2.5">
                <Icono nombre="check" size={16} className="mt-0.5 shrink-0 text-ink-3" />
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-strong">{t.titulo}</div>
                  <div className={clsx("text-[12px]", vencida ? "text-danger" : hoy ? "text-warn" : "text-ink-3")}>
                    {[t.fecha_limite ? `${vencida ? "⚠ venció " : ""}${formatoFechaHora.format(new Date(t.fecha_limite))}` : "Sin fecha", quien].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {tareas.length > MAXIMO && (
        <Link to="/tareas?vista=todas" className="mt-3 inline-block text-[12px] font-semibold text-navy hover:underline">
          Ver las {tareas.length} en Tareas ›
        </Link>
      )}
    </Tarjeta>
  );
}
