import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ServerError, inputBaseClass, inputClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { formatoFechaHora } from "../../lib/formato";
import { CLASE_PRIORIDAD, ETIQUETA_CLASIFICACION, ETIQUETA_PRIORIDAD, LIMITE_COLA, useColaClasificacion } from "../../lib/tareas";
import type { Clasificacion, TareaClasificacion } from "../../types";

// Cola de clasificación (solo administrador/supervisor): respuestas que
// esperan que una persona decida. La IA de n8n solo sugiere (migración
// 023, "modo sugerencia"); la decisión es de quien clasifica. Clasificar cierra la tarea y aplica la decisión en el
// backend (TareasService.clasificar): cambia el estado del prospecto, "baja"
// suprime todos los medios del contacto y "reagendar" crea un seguimiento.

const OPCIONES: { clave: Clasificacion; ayuda: string }[] = [
  { clave: "interesado", ayuda: "Quiere saber más: el prospecto pasa a interesado y se crea una tarea sin asignar para contactarlo." },
  { clave: "no_interesado", ayuda: "Respondió que no, sin pedir que no le escriban." },
  { clave: "baja", ayuda: "Pidió que no lo contacten. Se suprimen TODOS sus medios de contacto y no se le vuelve a escribir." },
  { clave: "invalido", ayuda: "El contacto no sirve (persona equivocada, dejó la empresa…): se descarta el prospecto." },
  { clave: "reagendar", ayuda: "Pidió que lo busquen después: se crea una tarea de seguimiento para ti en la fecha que elijas." }
];

export function ColaClasificacion() {
  const [page, setPage] = useState(1);
  // Arriba de la cola y no en la tarjeta: al refrescar, la tarjeta ya
  // clasificada (por quien sea) desaparece y se llevaría el mensaje.
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "warn" } | null>(null);
  const { data, isPending, isError } = useColaClasificacion(page);

  return (
    <div className="flex flex-col gap-4">
      {aviso && <div className={`rounded-[9px] px-3.5 py-2.5 text-[13px] ${aviso.tono === "ok" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>{aviso.texto}</div>}
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar la cola de clasificación.</div>}
      {data && data.data.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <div className="text-sm font-bold">No hay respuestas por clasificar</div>
          <div className="max-w-md text-[13px] text-ink-3">Aquí llegan las respuestas de los prospectos para que una persona confirme su clasificación.</div>
        </Card>
      )}
      {data?.data.map((t) => <ItemCola key={t.id} tarea={t} onAviso={(texto, tono) => setAviso({ texto, tono })} />)}
      {data && (page > 1 || data.data.length === LIMITE_COLA) && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-xs text-ink-3">Página {page}</span>
          <Button variant="ghost" disabled={data.data.length < LIMITE_COLA} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}

// Lo que propone la IA: la clasificación, qué tan segura está (0-100) y por
// qué. Es solo una ayuda para decidir; la decisión la toma quien clasifica.
// La IA sugiere con los valores de n8n (CLASIFICACIONES_N8N del backend):
// además de los de la cola, "automatica" (respuesta automática) y "ambigua".
const ETIQUETA_SOLO_IA: Record<string, string> = { automatica: "Respuesta automática", ambigua: "Ambigua" };

function SugerenciaIa({ respuesta }: { respuesta: NonNullable<TareaClasificacion["respuesta"]> }) {
  const sugerida = respuesta.clasificacion_sugerida ?? "";
  const etiqueta = ETIQUETA_CLASIFICACION[sugerida as Clasificacion] ?? ETIQUETA_SOLO_IA[sugerida] ?? sugerida.replace(/_/g, " ");
  const confianza = respuesta.confianza_sugerida;
  return (
    <div className="mt-3 rounded-[10px] border border-border px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-2">Sugerencia de la IA:</span>
        <span className="rounded-full bg-bg px-2.5 py-1 text-[11px] font-bold text-navy">{etiqueta}</span>
        {confianza != null && (
          <span className={`text-xs font-semibold ${confianza >= 80 ? "text-ok" : confianza >= 50 ? "text-warn" : "text-danger"}`} title="Qué tan segura está la IA de su sugerencia">
            {Math.round(confianza)}% de confianza
          </span>
        )}
      </div>
      {respuesta.motivo_sugerencia && <div className="mt-1.5 text-ink-2">{respuesta.motivo_sugerencia}</div>}
    </div>
  );
}

// "YYYY-MM-DDTHH:mm" local, para el min de un datetime-local.
function ahoraLocal() {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

function ItemCola({ tarea, onAviso }: { tarea: TareaClasificacion; onAviso: (texto: string, tono: "ok" | "warn") => void }) {
  const queryClient = useQueryClient();
  const [elegida, setElegida] = useState<Clasificacion | null>(null);
  const [comentario, setComentario] = useState("");
  const [fecha, setFecha] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const opcion = OPCIONES.find((o) => o.clave === elegida);

  async function clasificar() {
    if (!elegida) return;
    if (elegida === "reagendar" && (!fecha || new Date(fecha).getTime() <= Date.now())) {
      setError("Elige una fecha de seguimiento futura.");
      return;
    }
    setError(null);
    setOcupado(true);
    try {
      await api.post(`/api/v1/cola-clasificacion/${tarea.id}/clasificar`, {
        clasificacion: elegida,
        comentario: comentario.trim() || undefined,
        fechaSeguimiento: elegida === "reagendar" ? new Date(fecha).toISOString() : undefined
      });
      await queryClient.invalidateQueries({ queryKey: ["tareas"] });
      // "interesado" crea en el backend una tarea "Contactar prospecto
      // interesado" (seguimiento, alta, sin asignar, vence al final del
      // siguiente día hábil) para que un supervisor la reparta
      // (TareasService.crearTareaDeInteresado).
      const extra = elegida === "interesado" ? " Se creó la tarea «Contactar prospecto interesado», sin asignar y con vencimiento al final del siguiente día hábil; repártela desde la Bandeja." : "";
      onAviso(`${tarea.empresa_nombre ?? "Tarea " + tarea.id}: clasificada como ${ETIQUETA_CLASIFICACION[elegida].toLowerCase()}.${extra}`, "ok");
    } catch (err) {
      // Se compara contra el code, no contra el texto del mensaje. La
      // cola se refresca abajo y esta tarjeta desaparece; por eso el
      // aviso va arriba de la cola, con el nombre de la empresa.
      if (err instanceof ApiError && err.code === "RESPUESTA_YA_CLASIFICADA") {
        onAviso(`${tarea.empresa_nombre ?? "Tarea " + tarea.id}: esta respuesta ya fue clasificada por otra persona o por la IA; se recargó la cola.`, "warn");
      } else {
        // Otro 409 posible: "La tarea ya está cerrada" (otra persona la cerró primero).
        setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      }
      if (err instanceof ApiError && err.status === 409) await queryClient.invalidateQueries({ queryKey: ["tareas"] });
    } finally {
      setOcupado(false);
    }
  }

  const respuesta = tarea.respuesta;
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold">
            {tarea.empresa_id ? (
              <Link to={`/empresas/${tarea.empresa_id}`} className="hover:text-navy hover:underline">
                {tarea.empresa_nombre ?? `Empresa ${tarea.empresa_id}`}
              </Link>
            ) : (
              tarea.titulo
            )}
          </div>
          <div className="text-xs text-ink-3">
            {[tarea.contacto_nombre, tarea.contacto_puesto].filter(Boolean).join(" · ") || "Sin contacto"}
            {respuesta?.recibido_en && ` · respondió el ${formatoFechaHora.format(new Date(respuesta.recibido_en))}`}
            {respuesta?.canal && ` por ${respuesta.canal === "whatsapp" ? "WhatsApp" : "correo"}`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CLASE_PRIORIDAD[tarea.prioridad]}`}>{ETIQUETA_PRIORIDAD[tarea.prioridad]}</span>
        </div>
      </div>

      <blockquote className="mt-3 whitespace-pre-wrap rounded-[10px] border-l-4 border-cyan bg-bg px-4 py-3 text-[13px] text-ink">
        {respuesta?.contenido?.trim() || <span className="text-ink-3">{respuesta ? "La respuesta llegó sin texto." : (tarea.descripcion ?? "Tarea creada a mano, sin respuesta asociada.")}</span>}
      </blockquote>

      {respuesta?.clasificacion_sugerida && <SugerenciaIa respuesta={respuesta} />}

      <div className="mt-4 flex flex-wrap gap-2">
        {OPCIONES.map((o) => (
          <Button
            key={o.clave}
            variant={elegida === o.clave ? (o.clave === "baja" ? "primary" : "outline") : "ghost"}
            className={`px-3 py-1.5 ${elegida === o.clave ? "" : "border border-border"}`}
            disabled={ocupado}
            onClick={() => {
              setElegida(elegida === o.clave ? null : o.clave);
              setError(null);
            }}
          >
            {ETIQUETA_CLASIFICACION[o.clave]}
          </Button>
        ))}
      </div>

      {opcion && (
        <div className="mt-4 flex flex-col gap-3 rounded-[10px] border border-border p-4">
          <div className={`text-[13px] ${opcion.clave === "baja" ? "font-semibold text-danger" : "text-ink-2"}`}>{opcion.ayuda}</div>
          <div className="flex flex-wrap items-end gap-3">
            {opcion.clave === "reagendar" && (
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-ink-2">
                Fecha de seguimiento
                <input type="datetime-local" className={`${inputBaseClass} w-auto`} min={ahoraLocal()} value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </label>
            )}
            <label className="flex min-w-64 flex-1 flex-col gap-1.5 text-xs font-semibold text-ink-2">
              Comentario (opcional)
              <input className={inputClass} maxLength={4000} value={comentario} onChange={(e) => setComentario(e.target.value)} />
            </label>
            <Button variant={opcion.clave === "baja" ? "primary" : "exito"} disabled={ocupado} onClick={() => void clasificar()}>
              Clasificar como {ETIQUETA_CLASIFICACION[opcion.clave].toLowerCase()}
            </Button>
          </div>
          <ServerError message={error} />
        </div>
      )}
    </Card>
  );
}
