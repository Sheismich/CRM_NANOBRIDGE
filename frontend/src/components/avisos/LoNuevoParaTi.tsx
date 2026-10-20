import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Tarjeta } from "../ui/Tarjeta";
import { useAhora } from "../../lib/reloj";
import { horaAviso, leerTodas, tipoAviso, useAbrirAviso, useAvisosNuevos } from "../../lib/notificaciones";
import { PanelAvisos } from "./PanelAvisos";

// "Lo nuevo para ti" (opción D del 20-oct-2026, docs/diseno/avisos-menu.html):
// los avisos sin leer arriba del Inicio, en lugar de una campanita en el
// menú. El numerito va en la opción Inicio. Sin nada nuevo queda un solo
// renglón para abrir los anteriores y las opciones del correo.
export function LoNuevoParaTi({ className }: { className?: string }) {
  const queryClient = useQueryClient();
  const nuevos = useAvisosNuevos();
  const abrir = useAbrirAviso();
  const ahora = useAhora();
  const [panel, setPanel] = useState(false);
  const [fallo, setFallo] = useState(false);

  // Mientras carga o si falla, no estorba: el Inicio sigue igual.
  if (!nuevos.data) return null;
  const avisos = nuevos.data.notificaciones;
  const total = nuevos.data.no_leidas;

  const verTodos = (
    <button type="button" onClick={() => setPanel(true)} className="font-bold text-navy hover:underline dark:text-cyan">
      {total > 0 ? "Ver todos" : "Ver avisos anteriores"}
    </button>
  );

  async function marcarTodas() {
    setFallo(false);
    try {
      await leerTodas(queryClient);
    } catch {
      setFallo(true);
    }
  }

  return (
    <>
      {total === 0 ? (
        <Tarjeta estilo="relieve" className={className} cuerpoClassName="!py-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
            <span className="text-ink-2">
              <b className="font-heading text-strong">Lo nuevo para ti:</b> nada nuevo por ahora.
            </span>
            <span className="text-[12px]">{verTodos}</span>
          </div>
        </Tarjeta>
      ) : (
        <Tarjeta
          estilo="relieve"
          className={className}
          titulo={
            <span className="flex items-center gap-2">
              Lo nuevo para ti
              <span className="rounded-full bg-cyan px-[7px] py-px text-[11px] font-extrabold text-[#06121a]">{total}</span>
            </span>
          }
          extra={
            <span className="flex items-center gap-4">
              <button type="button" onClick={() => void marcarTodas()} className="hidden font-bold text-ink-2 hover:text-strong sm:inline">
                Marcar como leídas
              </button>
              {verTodos}
            </span>
          }
          cuerpoClassName="!py-2"
        >
          {fallo && <p className="py-2 text-[12.5px] text-danger">No se pudieron marcar. Intenta otra vez.</p>}
          <ul>
            {avisos.map((aviso) => {
              const tipo = tipoAviso(aviso.tipo);
              return (
                <li key={aviso.id} className="border-t border-[var(--relieve-linea)] first:border-t-0">
                  <button type="button" onClick={() => void abrir(aviso)} className="flex w-full items-center gap-3 py-2.5 text-left">
                    <span className={clsx("h-8 w-[3px] shrink-0 rounded-full", tipo.raya)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-bold text-strong">{aviso.titulo}</span>
                      {aviso.cuerpo && <span className="block truncate text-[12.5px] text-ink-2">{aviso.cuerpo}</span>}
                    </span>
                    <span className={clsx("hidden shrink-0 rounded-[6px] px-2 py-px text-[11px] font-extrabold sm:inline-block", tipo.pastilla)}>{tipo.etiqueta}</span>
                    <span className="shrink-0 text-[11.5px] font-semibold text-ink-3">{horaAviso(aviso.creado_en, ahora)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      )}
      <PanelAvisos abierto={panel} onCerrar={() => setPanel(false)} />
    </>
  );
}
