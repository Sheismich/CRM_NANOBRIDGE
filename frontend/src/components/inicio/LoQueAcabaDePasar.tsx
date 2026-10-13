import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { agruparFeed, horaEvento, TEXTO_CLASIFICACION, textoContacto, type ElementoFeed } from "../../lib/inicio";
import { plural } from "../../lib/formato";
import type { EventoReciente } from "../../types";

// "Lo que acaba de pasar" (inicio-aprobado.html): hora, puntito de color y
// la frase. Respuestas, lotes de envíos, bajas y las respuestas que
// esperan clasificación (con liga a la cola). `pendientesCola` es el total
// real de la cola (el feed solo trae las más recientes).
const MAXIMO = 6;

export function LoQueAcabaDePasar({ eventos, pendientesCola, ahora }: { eventos: EventoReciente[]; pendientesCola?: number; ahora: Date }) {
  const elementos = agruparFeed(eventos).slice(0, MAXIMO);
  if (elementos.length === 0) {
    return <p className="py-2 text-[13px] text-ink-2">Todavía no pasa nada: aquí van a salir los correos que mande la automatización, las respuestas y las bajas.</p>;
  }
  return (
    <ul>
      {elementos.map((e) => (
        <li key={e.clave} className="grid grid-cols-[46px_14px_1fr] items-start gap-2.5 border-t border-[var(--relieve-linea)] py-2.5 first:border-t-0 first:pt-0">
          <span className="text-[12px] text-ink-3">{horaEvento(e.fecha, ahora)}</span>
          <span className={clsx("mt-1 h-2.5 w-2.5 rounded-full", colorPunto(e))} />
          <Frase elemento={e} pendientesCola={pendientesCola} />
        </li>
      ))}
    </ul>
  );
}

function colorPunto(e: ElementoFeed) {
  if (e.tipo === "cola") return "bg-warn";
  if (e.tipo === "envios") return "bg-cyan";
  if (e.tipo === "baja") return "bg-danger";
  const c = e.evento.clasificacion;
  if (c === "interesado") return "bg-mint shadow-[0_0_8px_var(--mint)]";
  if (c === "baja") return "bg-danger";
  if (c === "reagendar") return "bg-navy";
  return "bg-ink-3";
}

function Empresa({ id, nombre }: { id: number; nombre: string }) {
  return (
    <Link to={`/empresas/${id}`} className="hover:text-navy hover:underline">
      {nombre}
    </Link>
  );
}

function Frase({ elemento: e, pendientesCola }: { elemento: ElementoFeed; pendientesCola?: number }) {
  const texto = "text-[13px] text-ink-2 [&_b]:text-strong";
  const detalle = "mt-0.5 block text-[12px] text-ink-3";
  if (e.tipo === "cola") {
    const n = Math.max(pendientesCola ?? 0, e.cantidad);
    return (
      <span className={texto}>
        <b>{plural(n, "respuesta", "respuestas")}</b> {n === 1 ? "espera" : "esperan"} clasificación{" "}
        <Link to="/tareas?tab=cola" className="ml-1 text-[12px] font-extrabold text-info hover:underline">
          Ir a la cola →
        </Link>
        <small className={detalle}>La automatización no pudo sola</small>
      </span>
    );
  }
  if (e.tipo === "envios") {
    return (
      <span className={texto}>
        {e.cantidad === 1 ? (
          <>
            Se le envió el {textoContacto(e.numero, 1)} a <b>{e.persona.contacto_nombre}</b>
          </>
        ) : (
          <>
            Se enviaron <b>{e.cantidad} {e.numero <= 1 ? "correos iniciales" : "recordatorios"}</b>
          </>
        )}
        <small className={detalle}>{e.cantidad === 1 ? <Empresa id={e.persona.empresa_id} nombre={e.persona.empresa_nombre} /> : `${e.campana ?? "Sin campaña"}${e.numero > 1 ? ` · ${textoContacto(e.numero, 1)}` : ""}`}</small>
      </span>
    );
  }
  if (e.tipo === "baja") {
    return (
      <span className={texto}>
        <b>{e.evento.contacto_nombre}</b> pidió su baja
        <small className={detalle}>
          <Empresa id={e.evento.empresa_id} nombre={e.evento.empresa_nombre} /> · Ya no se le vuelve a escribir
        </small>
      </span>
    );
  }
  const ev = e.evento;
  const que = ev.clasificacion ? (TEXTO_CLASIFICACION[ev.clasificacion] ?? ev.clasificacion) : "sin clasificar";
  return (
    <span className={texto}>
      <b>{ev.contacto_nombre}</b> respondió: {que}
      {ev.tardia && <span className="text-ink-3"> (tarde)</span>}
      <small className={detalle}>
        <Empresa id={ev.empresa_id} nombre={ev.empresa_nombre} />
        {ev.campana_nombre && ` · campaña ${ev.campana_nombre}`}
      </small>
    </span>
  );
}
