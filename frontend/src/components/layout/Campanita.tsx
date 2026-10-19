import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Icono } from "../ui/Icono";
import { PanelLateral } from "../ui/PanelLateral";
import { horaEvento } from "../../lib/inicio";
import { cambiarAvisosPorCorreo, leerTodas, marcarLeida, useConteoNotificaciones, useNotificaciones, usePreferenciasAvisos, type Notificacion } from "../../lib/notificaciones";

// Campanita de avisos (etapa 2 de las mejoras, 19-oct-2026): numerito con
// los no leídos; al abrir, la lista. Clic en un aviso = marcarlo leído e ir
// a su pantalla. Abajo, el interruptor de los correos de aviso.
export function Campanita({ sobreOscuro = false }: { sobreOscuro?: boolean }) {
  const [abierta, setAbierta] = useState(false);
  const { data: conteo } = useConteoNotificaciones();
  const noLeidas = conteo?.no_leidas ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-label={noLeidas > 0 ? `Avisos, ${noLeidas} sin leer` : "Avisos"}
        title="Avisos"
        className={clsx("relative grid h-9 w-9 place-items-center rounded-[10px]", sobreOscuro ? "text-white/85 hover:bg-white/10" : "text-ink-2 hover:bg-soft hover:text-strong")}
      >
        <Icono nombre="campana" size={19} />
        {noLeidas > 0 && (
          <em className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-cyan px-[5px] py-px text-center text-[10px] font-extrabold not-italic text-[#06121a]">
            {noLeidas > 99 ? "99+" : noLeidas}
          </em>
        )}
      </button>
      <PanelAvisos abierta={abierta} onCerrar={() => setAbierta(false)} />
    </>
  );
}

function PanelAvisos({ abierta, onCerrar }: { abierta: boolean; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const lista = useNotificaciones(abierta);
  const preferencias = usePreferenciasAvisos(abierta);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const avisos = lista.data?.notificaciones ?? [];
  const hayNoLeidas = (lista.data?.no_leidas ?? 0) > 0;

  async function abrir(aviso: Notificacion) {
    setError(null);
    try {
      if (!aviso.leida) await marcarLeida(queryClient, aviso.id);
    } catch {
      // Si no se pudo marcar, igual se abre lo que avisa.
    }
    onCerrar();
    if (aviso.enlace) navigate(aviso.enlace);
  }

  async function marcarTodas() {
    setError(null);
    try {
      await leerTodas(queryClient);
    } catch {
      setError("No se pudieron marcar. Intenta otra vez.");
    }
  }

  async function cambiarCorreo(valor: boolean) {
    setError(null);
    setGuardando(true);
    try {
      await cambiarAvisosPorCorreo(queryClient, valor);
    } catch {
      setError("No se pudo guardar. Intenta otra vez.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <PanelLateral
      abierto={abierta}
      onCerrar={onCerrar}
      ancho={420}
      cuerpoClassName="!p-0 flex flex-col"
      encabezado={
        <div className="flex items-center gap-3 pt-0.5">
          <h2 className="font-heading text-[16px] font-bold text-strong">Avisos</h2>
          {hayNoLeidas && (
            <button type="button" onClick={() => void marcarTodas()} className="ml-auto text-[12.5px] font-bold text-navy hover:underline dark:text-cyan">
              Marcar todas como leídas
            </button>
          )}
        </div>
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        {lista.isPending && <p className="p-5 text-[13px] text-ink-3">Cargando…</p>}
        {lista.isError && <p className="p-5 text-[13px] text-danger">No se pudieron cargar los avisos.</p>}
        {lista.data && avisos.length === 0 && <p className="p-5 text-[13px] text-ink-2">No tienes avisos. Aquí te llegan las tareas que te asignen, los interesados y lo que se venza.</p>}
        {avisos.map((aviso) => (
          <button
            key={aviso.id}
            type="button"
            onClick={() => void abrir(aviso)}
            className={clsx("flex w-full items-start gap-3 border-b border-border px-4 py-3 text-left hover:bg-soft md:px-5", !aviso.leida && "bg-mint/5")}
          >
            <span className={clsx("mt-[7px] h-[7px] w-[7px] shrink-0 rounded-full", aviso.leida ? "bg-transparent" : "bg-mint shadow-[0_0_8px_var(--mint)]")} />
            <span className="min-w-0 flex-1">
              <span className={clsx("block text-[13.5px] leading-snug", aviso.leida ? "font-semibold text-ink-2" : "font-bold text-strong")}>{aviso.titulo}</span>
              {aviso.cuerpo && <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-[12.5px] text-ink-3">{aviso.cuerpo}</span>}
            </span>
            <span className="shrink-0 pt-0.5 text-[11.5px] font-semibold text-ink-3">{horaEvento(aviso.creado_en, new Date())}</span>
          </button>
        ))}
      </div>

      <div className="border-t border-border px-4 py-3.5 md:px-5">
        {error && <p className="mb-2 text-[12.5px] text-danger">{error}</p>}
        <label className="flex items-center gap-3 text-[13px]">
          <input
            type="checkbox"
            className="h-4 w-4 accent-navy"
            checked={preferencias.data?.avisos_por_correo ?? true}
            disabled={!preferencias.data || guardando}
            onChange={(e) => void cambiarCorreo(e.target.checked)}
          />
          <span>
            <b className="block text-strong">Recibir avisos por correo</b>
            <small className="text-[12px] text-ink-3">Tareas asignadas, interesados, tareas vencidas y documentos rechazados. La campanita sigue aunque lo apagues.</small>
          </span>
        </label>
      </div>
    </PanelLateral>
  );
}
