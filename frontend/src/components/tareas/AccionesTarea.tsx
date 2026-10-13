import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { ServerError, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { atajosReprogramar, valorDatetimeLocal } from "../../lib/mi-dia";

// Ventanas de "Hecha" y "Reprogramar" (Mi día y Ver todas). Al guardar se
// refresca todo lo de ["tareas"] (listas, conteos del anillo y el numerito
// del menú).

const RESULTADOS_RAPIDOS = ["Hablé con la persona", "No contestó", "Le dejé mensaje", "Le envié la información", "Ya quedó"];

function mensajeDe(err: unknown) {
  return err instanceof ApiError ? err.message : "No se pudo conectar con el servidor";
}

export function ModalHecha({ tarea, onCerrar, onHecha }: { tarea: { id: number; titulo: string } | null; onCerrar: () => void; onHecha?: () => void }) {
  return (
    <Modal abierto={tarea !== null} onCerrar={onCerrar} titulo="Marcar como hecha" descripcion={tarea?.titulo}>
      {tarea && <FormHecha tareaId={tarea.id} onCerrar={onCerrar} onHecha={onHecha} />}
    </Modal>
  );
}

function FormHecha({ tareaId, onCerrar, onHecha }: { tareaId: number; onCerrar: () => void; onHecha?: () => void }) {
  const queryClient = useQueryClient();
  const [resultado, setResultado] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    if (resultado.trim().length < 2) {
      setError("Escribe qué pasó (mínimo 2 letras): así queda en el historial.");
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      await api.patch(`/api/v1/tareas/${tareaId}/cerrar`, { resultado: resultado.trim() });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
      onHecha?.();
      onCerrar();
    } catch (err) {
      setError(mensajeDe(err));
      // Ya la cerró alguien o se la reasignaron: la lista está vieja.
      if (err instanceof ApiError && (err.code === "TAREA_CERRADA" || err.code === "TAREA_REASIGNADA")) await queryClient.invalidateQueries({ queryKey: ["tareas"] });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="hecha-resultado" className="text-[13px] font-bold text-strong">
        ¿Qué pasó?
      </label>
      <div className="flex flex-wrap gap-1.5">
        {RESULTADOS_RAPIDOS.map((r) => (
          <button key={r} type="button" onClick={() => setResultado(r)} className="rounded-full border border-border bg-soft px-3 py-1 text-[12px] font-semibold text-ink-2 hover:border-navy/40 hover:text-strong">
            {r}
          </button>
        ))}
      </div>
      <textarea
        id="hecha-resultado"
        data-autofocus
        maxLength={4000}
        rows={3}
        className={inputClass}
        placeholder="Ej. Hablé con Ana, le mando la cotización el jueves."
        value={resultado}
        onChange={(e) => setResultado(e.target.value)}
      />
      <ServerError message={error} />
      <div className="flex justify-end gap-2.5">
        <Button variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button variant="aprobar" disabled={ocupado} onClick={() => void guardar()}>
          {ocupado ? "Guardando…" : "Marcar como hecha"}
        </Button>
      </div>
    </div>
  );
}

export function ModalReprogramar({ tarea, onCerrar }: { tarea: { id: number; titulo: string } | null; onCerrar: () => void }) {
  return (
    <Modal abierto={tarea !== null} onCerrar={onCerrar} titulo="Reprogramar" descripcion={tarea?.titulo}>
      {tarea && <FormReprogramar tareaId={tarea.id} onCerrar={onCerrar} />}
    </Modal>
  );
}

function FormReprogramar({ tareaId, onCerrar }: { tareaId: number; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const ahora = new Date();
  const atajos = atajosReprogramar(ahora);
  const [valor, setValor] = useState(valorDatetimeLocal(atajos[0].fecha));
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    const fecha = new Date(valor);
    if (Number.isNaN(fecha.getTime()) || fecha.getTime() <= Date.now()) {
      setError("Elige una fecha y hora que todavía no pasen.");
      return;
    }
    setOcupado(true);
    setError(null);
    try {
      await api.patch(`/api/v1/tareas/${tareaId}/reprogramar`, { fechaLimite: fecha.toISOString() });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
      onCerrar();
    } catch (err) {
      setError(mensajeDe(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {atajos.map((a) => {
          const v = valorDatetimeLocal(a.fecha);
          return (
            <button
              key={a.etiqueta}
              type="button"
              onClick={() => setValor(v)}
              aria-pressed={valor === v}
              className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${valor === v ? "border-navy bg-navy-bg text-navy" : "border-border bg-soft text-ink-2 hover:text-strong"}`}
            >
              {a.etiqueta}
            </button>
          );
        })}
      </div>
      <label htmlFor="reprog-fecha" className="text-[13px] font-bold text-strong">
        Nueva fecha límite
      </label>
      <input id="reprog-fecha" type="datetime-local" className={inputClass} min={valorDatetimeLocal(ahora)} value={valor} onChange={(e) => setValor(e.target.value)} />
      <ServerError message={error} />
      <div className="flex justify-end gap-2.5">
        <Button variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button disabled={ocupado} onClick={() => void guardar()}>
          {ocupado ? "Guardando…" : "Reprogramar"}
        </Button>
      </div>
    </div>
  );
}
