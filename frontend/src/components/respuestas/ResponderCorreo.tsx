import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PanelLateral } from "../ui/PanelLateral";
import { Button } from "../ui/Button";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import { ServerError, inputClass } from "../ui/Field";
import { ApiError } from "../../lib/api";
import { contestarRespuesta, pedirBorrador, useContextoRespuesta } from "../../lib/respuestas";
import type { ContextoRespuesta } from "../../types";

// Contestarle al prospecto desde el CRM (etapa 3, 20-oct-2026). Arriba lo
// que escribió; luego Para y Asunto (fijos), el texto, "Redactar con IA",
// la firma que se agrega sola y la casilla de la tarea. El correo sale como
// "<tu nombre> · NANOBRIDGE" y, si el cliente contesta, regresa al CRM.
// Se abre desde el Historial de la ficha y desde la tarea del interesado.
export function ResponderCorreo({ respuestaId, onCerrar }: { respuestaId: number | null; onCerrar: () => void }) {
  return (
    <PanelLateral abierto={respuestaId !== null} onCerrar={onCerrar} ancho={640} titulo="Responder por correo">
      {respuestaId !== null && <Contenido key={respuestaId} respuestaId={respuestaId} onCerrar={onCerrar} />}
    </PanelLateral>
  );
}

function Contenido({ respuestaId, onCerrar }: { respuestaId: number; onCerrar: () => void }) {
  const { data: c, isPending, isError, error } = useContextoRespuesta(respuestaId);
  if (isPending) return <p className="text-[13px] text-ink-3">Cargando…</p>;
  if (isError || !c) return <ServerError message={error instanceof ApiError ? error.message : "No se pudo cargar la respuesta."} />;
  return <Formulario c={c} onCerrar={onCerrar} />;
}

const formatoFecha = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Formulario({ c, onCerrar }: { c: ContextoRespuesta; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [borrador, setBorrador] = useState<{ id: number; texto: string } | null>(null);
  const [cerrarTarea, setCerrarTarea] = useState(true);
  const [redactando, setRedactando] = useState(false);
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<{ tareaCerrada: boolean } | null>(null);

  async function redactar() {
    if (texto.trim() && !window.confirm("La IA va a reemplazar lo que ya escribiste. ¿Seguir?")) return;
    setRedactando(true);
    setError(null);
    try {
      const b = await pedirBorrador(c.respuesta_id);
      setBorrador({ id: b.borrador_id, texto: b.texto });
      setTexto(b.texto);
      setAviso("Revisa el borrador antes de mandarlo: la IA puede equivocarse.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo redactar con IA; escríbelo tú.");
    } finally {
      setRedactando(false);
    }
  }

  async function mandar() {
    if (!texto.trim()) {
      setError("Escribe la respuesta.");
      return;
    }
    setMandando(true);
    setError(null);
    try {
      const res = await contestarRespuesta(queryClient, c.respuesta_id, { texto, ...(borrador ? { borrador_id: borrador.id } : {}), cerrar_tarea: c.tarea_abierta && cerrarTarea }, c.empresa_id);
      setEnviado({ tareaCerrada: res.tarea_cerrada });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor.");
    } finally {
      setMandando(false);
    }
  }

  if (enviado) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-bg text-ok">
          <Icono nombre="check" size={24} strokeWidth={3} />
        </span>
        <h3 className="font-heading text-[17px] font-extrabold text-strong">Le mandaste tu respuesta a {c.contacto_nombre}</h3>
        <p className="max-w-[380px] text-[13px] text-ink-2">
          Queda en el Historial de {c.empresa_nombre}. Si contesta, te llega un aviso a la campanita.
          {enviado.tareaCerrada && " La tarea quedó como hecha."}
        </p>
        <Button variant="outline" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[14px] border border-border bg-soft px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
          <b className="text-[13px] text-strong">{c.contacto_nombre}</b>
          <span>· {c.empresa_nombre}</span>
          <span>· {formatoFecha.format(new Date(c.recibido_en))}</span>
          {c.en_conversacion && <Pastilla tono="navy">En conversación</Pastilla>}
        </div>
        <p className="mt-2 max-h-[180px] overflow-y-auto whitespace-pre-line text-[13.5px] leading-relaxed text-ink">{c.contenido || "(sin texto)"}</p>
      </section>

      {!c.puede_responder ? (
        <div className="rounded-[12px] bg-warn-bg px-4 py-3 text-[13px] text-warn">
          <b>No se le puede contestar desde aquí.</b> {c.motivo}
        </div>
      ) : (
        <>
          <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
            <dt className="font-bold text-ink-3">Para</dt>
            <dd className="min-w-0 break-all text-strong">{c.para}</dd>
            <dt className="font-bold text-ink-3">Asunto</dt>
            <dd className="min-w-0 break-words text-strong">{c.asunto}</dd>
          </dl>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="respuesta-texto" className="text-xs font-semibold text-ink-2">
                Tu respuesta
              </label>
              <Button type="button" variant="outline" className="px-3 py-1.5 text-[12.5px]" disabled={redactando || mandando} onClick={() => void redactar()}>
                <Icono nombre="chispas" size={15} /> {redactando ? "Redactando…" : "Redactar con IA"}
              </Button>
            </div>
            <textarea
              id="respuesta-texto"
              rows={9}
              maxLength={5000}
              className={`${inputClass} resize-y text-[14px] leading-relaxed`}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={`Hola, ${c.contacto_nombre.split(" ")[0]}…`}
            />
            {aviso && <p className="text-[12px] text-info">{aviso}</p>}
          </div>

          <div className="rounded-[12px] border border-dashed border-border px-4 py-3 text-[12.5px] text-ink-3">
            <span className="font-bold text-ink-2">Se agrega sola al final:</span>
            <p className="mt-1 whitespace-pre-line text-ink-2">{c.firma}</p>
            <p className="mt-1">y el pie de los correos de NANOBRIDGE.</p>
          </div>

          {c.tarea_abierta && (
            <label className="flex items-center gap-2 text-[13px] text-ink">
              <input type="checkbox" className="h-4 w-4 accent-[var(--navy)]" checked={cerrarTarea} onChange={(e) => setCerrarTarea(e.target.checked)} />
              Marcar la tarea como hecha
            </label>
          )}

          <ServerError message={error} />

          <div className="flex flex-wrap justify-end gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
            <Button type="button" variant="outline" onClick={onCerrar} disabled={mandando}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void mandar()} disabled={mandando || redactando}>
              <Icono nombre="correo" size={16} /> {mandando ? "Mandando…" : "Mandar respuesta"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
