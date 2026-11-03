import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Modal } from "../ui/Modal";
import { ApiError } from "../../lib/api";
import { cambiarSaludo, mandarCotizacionPorCorreo, useContextoCorreoCotizacion } from "../../lib/cotizaciones";
import type { ContextoCorreoCotizacion } from "../../types";

// Mandar la cotización por correo (3-nov-2026): a quién, asunto y texto
// listos para cambiar, y el PDF que se adjunta solo. Sale como "<tu nombre>
// · NANOBRIDGE" con tu firma y el pie, sin "Darte de baja". Si el cliente
// contesta, te llega a tu correo. Una en borrador queda como enviada.
export function MandarCotizacionCorreo({ id, empresaId, abierto, onCerrar }: { id: number; empresaId: number; abierto: boolean; onCerrar: () => void }) {
  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Mandar por correo" ancho={560}>
      {abierto && <Contenido id={id} empresaId={empresaId} onCerrar={onCerrar} />}
    </Modal>
  );
}

function Contenido({ id, empresaId, onCerrar }: { id: number; empresaId: number; onCerrar: () => void }) {
  const { data: c, isPending, isError, error } = useContextoCorreoCotizacion(id);
  if (isPending) return <p className="pb-2 text-[13px] text-ink-3">Cargando…</p>;
  if (isError || !c) return <ServerError message={error instanceof ApiError ? error.message : "No se pudo cargar la cotización."} />;
  return <Formulario c={c} empresaId={empresaId} onCerrar={onCerrar} />;
}

function Formulario({ c, empresaId, onCerrar }: { c: ContextoCorreoCotizacion; empresaId: number; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const [contactoId, setContactoId] = useState<number | null>(c.contacto_id);
  const [asunto, setAsunto] = useState(c.asunto);
  const [texto, setTexto] = useState(c.texto);
  const [mandando, setMandando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviadoA, setEnviadoA] = useState<string | null>(null);

  const contacto = c.contactos.find((x) => x.id === contactoId) ?? null;
  const disponibles = c.contactos.filter((x) => !x.motivo);

  function elegir(nuevoId: number) {
    const nuevo = c.contactos.find((x) => x.id === nuevoId) ?? null;
    setTexto((t) => cambiarSaludo(t, contacto?.nombre ?? null, nuevo?.nombre ?? null));
    setContactoId(nuevoId);
  }

  async function mandar() {
    if (!contacto) return setError("Elige a quién se la mandas.");
    if (!asunto.trim()) return setError("Escribe el asunto.");
    if (!texto.trim()) return setError("Escribe el texto del correo.");
    setMandando(true);
    setError(null);
    try {
      await mandarCotizacionPorCorreo(queryClient, c.cotizacion_id, empresaId, { contactoId: contacto.id, asunto, texto });
      setEnviadoA(contacto.nombre);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor.");
    } finally {
      setMandando(false);
    }
  }

  if (enviadoA) {
    return (
      <div className="flex flex-col items-center gap-3 pb-4 pt-2 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-ok-bg text-ok">
          <Icono nombre="check" size={24} strokeWidth={3} />
        </span>
        <h3 className="font-heading text-[17px] font-extrabold text-strong">Le mandaste la cotización a {enviadoA}</h3>
        <p className="max-w-[380px] text-[13px] text-ink-2">Queda en el Historial de la empresa. Si contesta, la respuesta te llega a tu correo.</p>
        <Button variant="outline" onClick={onCerrar}>
          Cerrar
        </Button>
      </div>
    );
  }

  if (c.motivo) {
    return (
      <div className="flex flex-col gap-3 pb-2">
        <div className="rounded-[12px] bg-warn-bg px-4 py-3 text-[13px] text-warn">
          <b>No se puede mandar.</b> {c.motivo}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  if (disponibles.length === 0) {
    return (
      <div className="flex flex-col gap-3 pb-2">
        <div className="rounded-[12px] bg-warn-bg px-4 py-3 text-[13px] text-warn">
          <b>No hay a quién mandarla.</b> Ningún contacto de la empresa tiene un correo al que se le pueda escribir. Agrega uno en la ficha.
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={onCerrar}>
            Cerrar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3.5 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        void mandar();
      }}
    >
      <Field label="Para" htmlFor="cotizacion-para">
        <select id="cotizacion-para" className={inputClass} value={contactoId ?? ""} onChange={(e) => elegir(Number(e.target.value))}>
          {contactoId === null && <option value="">Elige un contacto</option>}
          {c.contactos.map((x) => (
            <option key={x.id} value={x.id} disabled={Boolean(x.motivo)}>
              {x.nombre} · {x.correo}
              {x.motivo ? ` (${x.motivo})` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Asunto" htmlFor="cotizacion-asunto">
        <input id="cotizacion-asunto" className={inputClass} maxLength={200} value={asunto} onChange={(e) => setAsunto(e.target.value)} />
      </Field>
      <Field label="Texto" htmlFor="cotizacion-texto">
        <textarea id="cotizacion-texto" rows={7} maxLength={5000} className={`${inputClass} resize-y text-[14px] leading-relaxed`} value={texto} onChange={(e) => setTexto(e.target.value)} />
      </Field>

      <div className="rounded-[12px] border border-dashed border-border px-4 py-3 text-[12.5px] text-ink-3">
        <p className="flex items-center gap-1.5 font-bold text-ink-2">
          <Icono nombre="descargar" size={14} /> Va adjunta: {c.archivo}
        </p>
        <p className="mt-1">Se agregan solos tu firma y el pie de los correos de NANOBRIDGE. Si contesta, la respuesta te llega a tu correo.</p>
      </div>

      <ServerError message={error} />

      <div className="flex flex-wrap justify-end gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
        <Button type="button" variant="outline" onClick={onCerrar} disabled={mandando}>
          Cancelar
        </Button>
        <Button type="submit" disabled={mandando}>
          <Icono nombre="correo" size={16} /> {mandando ? "Mandando…" : "Mandar cotización"}
        </Button>
      </div>
    </form>
  );
}
