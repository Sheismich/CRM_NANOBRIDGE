import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PanelLateral } from "../ui/PanelLateral";
import { Button } from "../ui/Button";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import { ServerError, inputClass } from "../ui/Field";
import { ApiError } from "../../lib/api";
import { contestarRespuesta, pedirBorrador, useContextoRespuesta } from "../../lib/respuestas";
import type { ContextoRespuesta, CorreoDeEmpresa } from "../../types";

// Contestarle al prospecto desde el CRM (etapa 3, 20-oct-2026). Arriba lo
// que escribió; luego Para (cualquier contacto de la empresa) y Copia
// (18-nov-2026), el Asunto fijo, el texto, "Redactar con IA",
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

// Para y copia (18-nov-2026): "Nombre · correo"; los que no se pueden usar
// salen desactivados con el motivo.
function etiqueta(m: CorreoDeEmpresa) {
  return `${m.nombre} · ${m.correo}${m.motivo ? ` (${m.motivo})` : ""}`;
}

function Formulario({ c, onCerrar }: { c: ContextoRespuesta; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [texto, setTexto] = useState("");
  const [borrador, setBorrador] = useState<{ id: number; texto: string } | null>(null);
  const [cerrarTarea, setCerrarTarea] = useState(true);
  const [paraId, setParaId] = useState<number | null>(c.para_medio_id);
  const [copiaIds, setCopiaIds] = useState<number[]>([]);
  const [eligiendoCopia, setEligiendoCopia] = useState(false);
  const [redactando, setRedactando] = useState(false);
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviado, setEnviado] = useState<{ tareaCerrada: boolean; para: string; copias: number } | null>(null);

  const para = c.correos.find((m) => m.medio_id === paraId) ?? null;
  const paraCopia = c.correos.filter((m) => m.medio_id !== paraId);
  const copias = copiaIds.map((id) => c.correos.find((m) => m.medio_id === id)).filter((m): m is CorreoDeEmpresa => Boolean(m));
  const nombrePara = para?.nombre ?? c.contacto_nombre;

  function elegirPara(id: number) {
    setParaId(id);
    // El de Para no puede ir también en copia.
    setCopiaIds((ids) => ids.filter((x) => x !== id));
  }

  function alternarCopia(id: number, marcado: boolean) {
    setCopiaIds((ids) => (marcado ? [...ids, id] : ids.filter((x) => x !== id)));
  }

  async function redactar() {
    if (texto.trim() && !window.confirm("La IA va a reemplazar lo que ya escribiste. ¿Seguir?")) return;
    setRedactando(true);
    setError(null);
    try {
      const b = await pedirBorrador(c.respuesta_id, paraId);
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
    if (!para) {
      setError("Elige a quién le escribes.");
      return;
    }
    if (!texto.trim()) {
      setError("Escribe la respuesta.");
      return;
    }
    setMandando(true);
    setError(null);
    try {
      const res = await contestarRespuesta(
        queryClient,
        c.respuesta_id,
        { texto, ...(borrador ? { borrador_id: borrador.id } : {}), cerrar_tarea: c.tarea_abierta && cerrarTarea, para_medio_id: para.medio_id, copia_medio_ids: copias.map((m) => m.medio_id) },
        c.empresa_id
      );
      setEnviado({ tareaCerrada: res.tarea_cerrada, para: para.nombre, copias: copias.length });
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
        <h3 className="font-heading text-[17px] font-extrabold text-strong">
          Le mandaste tu respuesta a {enviado.para}
          {enviado.copias > 0 && ` con copia a ${enviado.copias === 1 ? "1 persona" : `${enviado.copias} personas`}`}
        </h3>
        <p className="max-w-[380px] text-[13px] text-ink-2">
          Queda en el Historial de {c.empresa_nombre}. Si contesta{enviado.copias > 0 ? " cualquiera de ellos" : ""}, te llega un aviso en «Lo nuevo para ti», en el Inicio.
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
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 text-[13px]">
            <label htmlFor="respuesta-para" className="pt-2 font-bold text-ink-3">
              Para
            </label>
            <select id="respuesta-para" className={`${inputClass} text-[13px]`} value={paraId ?? ""} onChange={(e) => elegirPara(Number(e.target.value))}>
              {paraId === null && <option value="">Elige a quién le escribes</option>}
              {c.correos.map((m) => (
                <option key={m.medio_id} value={m.medio_id} disabled={Boolean(m.motivo)}>
                  {etiqueta(m)}
                </option>
              ))}
            </select>

            <span className="pt-1 font-bold text-ink-3">Copia</span>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {copias.map((m) => (
                  <span key={m.medio_id} className="inline-flex max-w-full items-center gap-1 rounded-full bg-soft py-1 pl-2.5 pr-1 text-[12px] text-strong ring-1 ring-border">
                    <span className="truncate" title={m.correo}>
                      {m.nombre} · {m.correo}
                    </span>
                    <button type="button" className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-ink-3 hover:bg-card hover:text-strong" aria-label={`Quitar a ${m.nombre} de la copia`} onClick={() => alternarCopia(m.medio_id, false)}>
                      <Icono nombre="cerrar" size={12} />
                    </button>
                  </span>
                ))}
                {paraCopia.length > 0 ? (
                  <button type="button" className="rounded-full px-2 py-1 text-[12px] font-bold text-navy hover:bg-soft" aria-expanded={eligiendoCopia} onClick={() => setEligiendoCopia((v) => !v)}>
                    {eligiendoCopia ? "Listo" : copias.length ? "Cambiar copia" : "Agregar copia"}
                  </button>
                ) : (
                  <span className="pt-1 text-[12px] text-ink-3">No hay otros correos en esta empresa. Para agregar uno, créalo como contacto en la ficha.</span>
                )}
              </div>
              {eligiendoCopia && paraCopia.length > 0 && (
                <fieldset className="flex max-h-[180px] flex-col gap-1 overflow-y-auto rounded-[12px] border border-border px-3 py-2">
                  <legend className="sr-only">Correos en copia</legend>
                  {paraCopia.map((m) => (
                    <label key={m.medio_id} className={`flex items-start gap-2 py-1 text-[12.5px] ${m.motivo ? "text-ink-3" : "text-ink"}`}>
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--navy)]" disabled={Boolean(m.motivo)} checked={copiaIds.includes(m.medio_id)} onChange={(e) => alternarCopia(m.medio_id, e.target.checked)} />
                      <span className="min-w-0 break-words">{etiqueta(m)}</span>
                    </label>
                  ))}
                </fieldset>
              )}
            </div>

            <span className="font-bold text-ink-3">Asunto</span>
            <span className="min-w-0 break-words text-strong">{c.asunto}</span>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label htmlFor="respuesta-texto" className="text-xs font-semibold text-ink-2">
                Tu respuesta
              </label>
              <Button
                type="button"
                variant="outline"
                className="px-3 py-1.5 text-[12.5px]"
                disabled={redactando || mandando || !c.ia_activa}
                title={c.ia_activa ? undefined : "La IA todavía no está encendida"}
                onClick={() => void redactar()}
              >
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
              placeholder={`Hola, ${nombrePara.split(" ")[0]}…`}
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
