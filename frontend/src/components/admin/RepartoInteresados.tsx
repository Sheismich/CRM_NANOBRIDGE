import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { ServerError } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import { ApiError, api } from "../../lib/api";
import { plural } from "../../lib/formato";
import type { Rol } from "../../types";

// Reparto automático de "Contactar prospecto interesado" (3-nov-2026).
// Prendido, cada interesado nuevo le toca a quien tenga menos abiertos de la
// lista; si la empresa ya es de un agente, va con él. Apagado (como
// empieza), nace sin asignar y se reparte a mano. Administrador y
// supervisor lo cambian; queda en el Registro de cambios.

type Reparto = {
  activo: boolean;
  usuario_ids: number[];
  usuarios: { id: number; nombre: string; rol: Rol; en_reparto: boolean; abiertas: number }[];
};

const ETIQUETA_ROL: Record<Rol, string> = { administrador: "Administrador", supervisor: "Supervisor", agente: "Agente", sistema: "Sistema" };

export function RepartoInteresados() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["reparto-interesados"],
    queryFn: () => api.get<Reparto>("/api/v1/tareas/reparto-interesados")
  });

  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex items-start gap-3 border-b border-border px-4 py-4 md:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-ok-bg text-ok">
          <Icono nombre="equipo" size={19} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[16px] font-extrabold text-strong">Reparto de interesados</h2>
          <p className="text-[12.5px] text-ink-3">A quién le toca la tarea cuando un prospecto contesta que le interesa.</p>
        </div>
      </header>
      <div className="px-4 py-3 md:px-5">
        {isPending && <p className="py-2 text-[13px] text-ink-3">Cargando…</p>}
        {isError && <p className="py-2 text-[13px] text-danger">No se pudo cargar el reparto.</p>}
        {data && <Formulario key={JSON.stringify([data.activo, data.usuario_ids])} reparto={data} />}
      </div>
    </section>
  );
}

function Formulario({ reparto }: { reparto: Reparto }) {
  const queryClient = useQueryClient();
  const [activo, setActivo] = useState(reparto.activo);
  const [elegidos, setElegidos] = useState<number[]>(reparto.usuario_ids);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardado, setGuardado] = useState(false);
  const cambio = activo !== reparto.activo || JSON.stringify(elegidos) !== JSON.stringify(reparto.usuario_ids);

  function alternar(id: number) {
    setGuardado(false);
    setElegidos((actual) => (actual.includes(id) ? actual.filter((x) => x !== id) : [...actual, id]));
  }

  async function guardar() {
    if (activo && elegidos.length === 0) {
      setError("Elige al menos a una persona, o deja el reparto apagado.");
      return;
    }
    setGuardando(true);
    setError(null);
    try {
      await api.put("/api/v1/tareas/reparto-interesados", { activo, usuarioIds: elegidos });
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["reparto-interesados"] }), queryClient.invalidateQueries({ queryKey: ["admin"] })]);
      setGuardado(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 py-1">
      <label className="flex items-start gap-3 rounded-[12px] border border-border px-3.5 py-3">
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--navy)]"
          checked={activo}
          onChange={(e) => {
            setGuardado(false);
            setActivo(e.target.checked);
          }}
        />
        <span className="text-[13px]">
          <b className="text-strong">Repartir solo</b>
          <span className="block text-ink-3">
            {activo
              ? "Cada interesado nuevo le toca a quien tenga menos abiertos de la lista. Si la empresa ya es de un agente, va con él."
              : "Apagado: la tarea nace sin asignar y un supervisor la reparte."}
          </span>
        </span>
      </label>

      <fieldset disabled={!activo} className={clsx("flex flex-col", !activo && "opacity-60")}>
        <legend className="mb-1.5 text-xs font-semibold text-ink-2">Quiénes reciben interesados</legend>
        <ul>
          {reparto.usuarios.map((u) => (
            <li key={u.id} className="border-t border-border first:border-t-0">
              <label className="flex items-center gap-3 py-2.5">
                <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--navy)]" checked={elegidos.includes(u.id)} onChange={() => alternar(u.id)} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-strong">{u.nombre}</span>
                <Pastilla tono={u.rol === "agente" ? "navy" : "neutro"}>{ETIQUETA_ROL[u.rol]}</Pastilla>
                <small className="w-[92px] shrink-0 text-right text-[11.5px] text-ink-3">{u.abiertas === 0 ? "sin abiertos" : `${plural(u.abiertas, "abierto", "abiertos")}`}</small>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <ServerError message={error} />
      {guardado && !cambio && <p className="text-[12.5px] text-ok">Guardado. Aplica desde el siguiente interesado.</p>}
      <div className="flex justify-end">
        <Button disabled={!cambio || guardando} onClick={() => void guardar()}>
          {guardando ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
