import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { PanelLateral } from "../ui/PanelLateral";
import { useAhora } from "../../lib/reloj";
import {
  cambiarAvisosPorCorreo,
  horaAviso,
  leerTodas,
  tipoAviso,
  useAbrirAviso,
  useNotificaciones,
  usePreferenciasAvisos,
  type Notificacion
} from "../../lib/notificaciones";

// Panel de avisos (versión 2 elegida el 20-oct-2026,
// docs/diseno/avisos-panel.html): filtro "Sin leer / Todos" arriba, cada
// aviso con su rayita y etiqueta de color, y el correo escondido en
// "Opciones". Se abre desde la tarjeta "Lo nuevo para ti" del Inicio.
export function PanelAvisos({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const lista = useNotificaciones(abierto);
  const [opciones, setOpciones] = useState(false);
  const noLeidas = lista.data?.no_leidas ?? 0;

  return (
    <PanelLateral
      abierto={abierto}
      onCerrar={() => {
        setOpciones(false);
        onCerrar();
      }}
      ancho={420}
      cuerpoClassName="!p-0 flex flex-col"
      encabezado={
        <div className="flex items-center gap-2.5 pt-1">
          <h2 className="font-heading text-[16px] font-bold text-strong">Avisos</h2>
          {noLeidas > 0 && <span className="rounded-full bg-cyan px-[7px] py-px text-[11px] font-extrabold text-[#06121a]">{noLeidas}</span>}
          <button
            type="button"
            onClick={() => setOpciones((v) => !v)}
            aria-expanded={opciones}
            className={clsx("ml-auto text-[12.5px] font-bold hover:text-strong", opciones ? "text-strong" : "text-ink-2")}
          >
            Opciones
          </button>
        </div>
      }
    >
      {/* Se monta al abrir: cada vez arranca en "Sin leer" si hay algo nuevo. */}
      <ListaAvisos avisos={lista.data?.notificaciones} noLeidas={noLeidas} cargando={lista.isPending} error={lista.isError} opciones={opciones} onCerrar={onCerrar} />
    </PanelLateral>
  );
}

function ListaAvisos({
  avisos,
  noLeidas,
  cargando,
  error,
  opciones,
  onCerrar
}: {
  avisos: Notificacion[] | undefined;
  noLeidas: number;
  cargando: boolean;
  error: boolean;
  opciones: boolean;
  onCerrar: () => void;
}) {
  const queryClient = useQueryClient();
  const abrir = useAbrirAviso(onCerrar);
  const ahora = useAhora();
  const [filtro, setFiltro] = useState<"sin_leer" | "todos" | null>(null);
  const [fallo, setFallo] = useState<string | null>(null);
  // Hasta que llega la lista no se sabe si hay sin leer: mientras, "Sin leer".
  const elegido = filtro ?? (avisos && noLeidas === 0 ? "todos" : "sin_leer");
  const visibles = (avisos ?? []).filter((a) => elegido === "todos" || !a.leida);

  async function marcarTodas() {
    setFallo(null);
    try {
      await leerTodas(queryClient);
    } catch {
      setFallo("No se pudieron marcar. Intenta otra vez.");
    }
  }

  return (
    <>
      {opciones && <OpcionesCorreo />}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 md:px-5">
        <Chip activo={elegido === "sin_leer"} onClick={() => setFiltro("sin_leer")}>
          Sin leer{noLeidas > 0 && ` (${noLeidas})`}
        </Chip>
        <Chip activo={elegido === "todos"} onClick={() => setFiltro("todos")}>
          Todos
        </Chip>
        {noLeidas > 0 && (
          <button type="button" onClick={() => void marcarTodas()} className="ml-auto whitespace-nowrap text-[12.5px] font-bold text-navy hover:underline dark:text-cyan">
            Marcar todas como leídas
          </button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {fallo && <p className="px-5 pt-3 text-[12.5px] text-danger">{fallo}</p>}
        {cargando && <p className="p-5 text-[13px] text-ink-3">Cargando…</p>}
        {error && <p className="p-5 text-[13px] text-danger">No se pudieron cargar los avisos.</p>}
        {avisos && visibles.length === 0 && (
          <div className="px-6 py-10 text-center text-[13px] leading-relaxed text-ink-2">
            {elegido === "sin_leer" ? (
              <>
                <b className="mb-1 block font-heading text-[14px] text-strong">Estás al día</b>
                No tienes avisos sin leer. En "Todos" están los anteriores.
              </>
            ) : (
              "No tienes avisos. Aquí te llegan las tareas que te asignen, los interesados y lo que se venza."
            )}
          </div>
        )}
        {visibles.map((aviso) => (
          <FilaAviso key={aviso.id} aviso={aviso} hora={horaAviso(aviso.creado_en, ahora)} onAbrir={() => void abrir(aviso)} />
        ))}
      </div>
    </>
  );
}

function FilaAviso({ aviso, hora, onAbrir }: { aviso: Notificacion; hora: string; onAbrir: () => void }) {
  const tipo = tipoAviso(aviso.tipo);
  return (
    <button type="button" onClick={onAbrir} className="flex w-full gap-3 border-b border-border px-4 py-3.5 text-left hover:bg-soft md:px-5">
      <span className={clsx("w-[3px] shrink-0 self-stretch rounded-full", tipo.raya, aviso.leida && "opacity-35")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={clsx("min-w-0 flex-1 text-[13.5px] leading-snug", aviso.leida ? "font-semibold text-ink-2" : "font-extrabold text-strong")}>{aviso.titulo}</span>
          {!aviso.leida && <span className="mt-[6px] h-[7px] w-[7px] shrink-0 rounded-full bg-mint shadow-[0_0_8px_var(--mint)]" aria-label="Sin leer" />}
        </span>
        {aviso.cuerpo && <span className={clsx("mt-0.5 line-clamp-2 block whitespace-pre-line text-[12.5px]", aviso.leida ? "text-ink-3" : "text-ink-2")}>{aviso.cuerpo}</span>}
        <span className="mt-2 flex items-center gap-2">
          <span className={clsx("rounded-[6px] px-2 py-px text-[11px] font-extrabold", tipo.pastilla)}>{tipo.etiqueta}</span>
          <span className="text-[11.5px] font-semibold text-ink-3">{hora}</span>
        </span>
      </span>
    </button>
  );
}

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activo}
      className={clsx("whitespace-nowrap rounded-full border px-3 py-1.5 text-[12.5px] font-bold", activo ? "border-strong bg-strong text-card" : "border-border text-ink-2 hover:text-strong")}
    >
      {children}
    </button>
  );
}

function OpcionesCorreo() {
  const queryClient = useQueryClient();
  const preferencias = usePreferenciasAvisos(true);
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const prendido = preferencias.data?.avisos_por_correo ?? true;

  async function cambiar() {
    setFallo(null);
    setGuardando(true);
    try {
      await cambiarAvisosPorCorreo(queryClient, !prendido);
    } catch {
      setFallo("No se pudo guardar. Intenta otra vez.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="border-b border-border bg-soft px-4 py-4 md:px-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <b className="block text-[13.5px] text-strong">Recibir avisos por correo</b>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-2">Tareas asignadas, interesados, tareas vencidas y documentos rechazados. Aquí en el CRM te siguen saliendo aunque lo apagues.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={prendido}
          aria-label="Recibir avisos por correo"
          disabled={!preferencias.data || guardando}
          onClick={() => void cambiar()}
          className={clsx("relative mt-0.5 h-[21px] w-9 shrink-0 rounded-full transition-colors disabled:opacity-60", prendido ? "bg-navy" : "bg-border")}
        >
          <span className={clsx("absolute left-[3px] top-[3px] h-[15px] w-[15px] rounded-full bg-white shadow transition-transform", prendido && "translate-x-[15px]")} />
        </button>
      </div>
      {fallo && <p className="mt-2 text-[12.5px] text-danger">{fallo}</p>}
    </div>
  );
}
