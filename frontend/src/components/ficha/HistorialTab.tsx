import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Button } from "../ui/Button";
import { Tarjeta } from "../ui/Tarjeta";
import { Icono } from "../ui/Icono";
import { NuevaActividadForm } from "./NuevaActividadForm";
import { ResponderCorreo } from "../respuestas/ResponderCorreo";
import { api } from "../../lib/api";
import { CLASIFICACIONES_SIN_RESPONDER } from "../../lib/respuestas";
import type { TimelineEvento } from "../../types";

const ETIQUETA_TIPO: Record<TimelineEvento["tipo"], string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  comentario: "Comentario",
  correo_enviado: "Correo enviado",
  correo_recibido: "Respuesta recibida",
  correo_respondido: "Respuesta por correo",
  tarea: "Tarea cerrada",
  cambio_estado_prospecto: "Cambio de estado del prospecto",
  documento_subido: "Documento subido",
  documento_revisado: "Documento revisado"
};

const ES_DOCUMENTO = new Set<TimelineEvento["tipo"]>(["documento_subido", "documento_revisado"]);

// Los que vienen de n8n (envíos/respuestas/cambios de estado) se marcan
// distinto de lo capturado a mano, para que se note qué hizo una persona.
const AUTOMATICOS = new Set<TimelineEvento["tipo"]>(["correo_enviado", "correo_recibido", "cambio_estado_prospecto"]);

// Clasificaciones de respuestas y tareas de clasificación (n8n pone las 5
// primeras; invalido/reagendar solo la clasificación manual, migración 022).
const ETIQUETA_RESULTADO: Record<string, string> = {
  interesado: "Interesado",
  no_interesado: "No interesado",
  baja: "Baja",
  automatica: "Respuesta automática",
  ambigua: "Ambigua",
  invalido: "Inválido",
  reagendar: "Reagendar",
  aprobado: "Aprobado",
  rechazado: "Rechazado"
};

const formatoFecha = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

// El texto principal de cada evento vive en un campo distinto de `detalle`
// según el tipo (ver *ToEvento() en actividades.service.ts).
function textoPrincipal(evento: TimelineEvento): string | null {
  const d = evento.detalle;
  if (evento.tipo === "tarea") return typeof d.titulo === "string" ? d.titulo : null;
  if (evento.tipo === "correo_recibido") return typeof d.contenido === "string" ? d.contenido : null;
  if (evento.tipo === "correo_respondido") return typeof d.texto === "string" ? d.texto : null;
  if (evento.tipo === "cambio_estado_prospecto") return typeof d.motivo === "string" ? d.motivo : null;
  if (evento.tipo === "correo_enviado") return typeof d.numero_contacto === "number" ? `Contacto #${d.numero_contacto} de la secuencia` : null;
  if (ES_DOCUMENTO.has(evento.tipo)) {
    const version = typeof d.version === "number" && d.version > 1 ? ` (versión ${d.version})` : "";
    return [typeof d.tipo_nombre === "string" ? d.tipo_nombre : null, typeof d.nombre === "string" ? `${d.nombre}${version}` : null].filter(Boolean).join(" · ") || null;
  }
  return typeof d.comentario === "string" ? d.comentario : null;
}

// `resultado` no es uniforme: en respuestas es la clasificación; en
// cambio_estado_prospecto, el estado nuevo; en llamadas/WhatsApp y tareas,
// texto libre (una tarea clasificada desde la cola guarda ahí el comentario,
// y la clasificación en detalle.clasificacion -- TareasService.clasificar).
// Solo lo que es una clave se muestra como etiqueta; el texto libre, aparte.
function claveEtiqueta(evento: TimelineEvento): string | null {
  const clasificacionTarea = evento.tipo === "tarea" && typeof evento.detalle.clasificacion === "string" ? evento.detalle.clasificacion : null;
  if (evento.tipo === "documento_revisado") return evento.resultado;
  const clave = clasificacionTarea ?? evento.resultado;
  if (clave && clave in ETIQUETA_RESULTADO) return clave;
  if (evento.tipo === "cambio_estado_prospecto") return evento.resultado;
  return null;
}

function resultadoLibre(evento: TimelineEvento): string | null {
  if (!evento.resultado || evento.tipo === "cambio_estado_prospecto" || evento.tipo === "documento_revisado" || evento.resultado in ETIQUETA_RESULTADO) return null;
  return evento.resultado;
}

function claseEtiqueta(clave: string) {
  if (clave === "interesado" || clave === "aprobado") return "bg-ok-bg text-ok";
  if (clave === "no_interesado" || clave === "baja" || clave === "invalido" || clave === "rechazado") return "bg-danger-bg text-danger";
  return "bg-soft text-ink-2";
}

// Historial unificado de la ficha (GET /actividades): lo registrado a mano,
// los correos y respuestas de la automatización, tareas cerradas y cambios
// de estado del prospecto y documentos (subidos y revisados), del más reciente
// al más viejo. Lo automático va
// con un punto cyan; las respuestas, con el color de su clasificación.
export function HistorialTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const [registrando, setRegistrando] = useState(false);
  const [respondiendo, setRespondiendo] = useState<number | null>(null);
  const { data, isPending, isError } = useQuery({
    queryKey: ["timeline", empresaId],
    queryFn: () => api.get<{ data: TimelineEvento[] }>("/api/v1/actividades", { empresaId, limit: 100 })
  });

  return (
    <Tarjeta
      titulo="Historial"
      icono="reloj"
      color="cyan"
      extra={
        !registrando && (
          <Button variant="outline" className="px-3 py-1.5 text-[12px]" onClick={() => setRegistrando(true)}>
            + Anotar lo que pasó
          </Button>
        )
      }
    >
      {registrando && (
        <div className="[&>form]:mb-4">
          <NuevaActividadForm empresaId={empresaId} contactos={contactos} onDone={() => setRegistrando(false)} />
        </div>
      )}
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar el historial.</div>}
      {data && data.data.length === 0 && <div className="text-sm text-ink-3">Todavía no ha pasado nada con esta empresa.</div>}

      {data && data.data.length > 0 && (
        <ol className="flex flex-col">
          {data.data.map((evento, i) => {
            const texto = textoPrincipal(evento);
            const clave = claveEtiqueta(evento);
            const libre = resultadoLibre(evento);
            const punto = clave === "interesado" || clave === "aprobado" ? "bg-ok" : clave === "baja" || clave === "no_interesado" || clave === "rechazado" ? "bg-danger" : AUTOMATICOS.has(evento.tipo) ? "bg-info" : "bg-navy";
            return (
              <li key={i} className="relative grid grid-cols-[86px_minmax(0,1fr)] gap-3 pb-4 last:pb-0 md:grid-cols-[110px_minmax(0,1fr)]">
                <span className="pt-0.5 text-[12px] font-bold text-strong">{formatoFecha.format(new Date(evento.fecha))}</span>
                <div className="relative min-w-0 border-l-2 border-border pl-4">
                  <span className={`absolute -left-[6px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-card ${punto}`} />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold text-strong">{ETIQUETA_TIPO[evento.tipo] ?? evento.tipo}</span>
                    {AUTOMATICOS.has(evento.tipo) && <span className="rounded-full bg-info-bg px-2 py-0.5 text-[10px] font-bold text-info">Automático</span>}
                    {clave && <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${claseEtiqueta(clave)}`}>{ETIQUETA_RESULTADO[clave] ?? clave}</span>}
                    {evento.tipo === "correo_respondido" && typeof evento.detalle.usuario_nombre === "string" && <span className="text-[12px] text-ink-3">{evento.detalle.usuario_nombre} desde el CRM</span>}
                    {ES_DOCUMENTO.has(evento.tipo) && typeof evento.detalle.usuario_nombre === "string" && <span className="text-[12px] text-ink-3">{evento.detalle.usuario_nombre}</span>}
                  </div>
                  {texto && <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{texto}</p>}
                  {libre && <p className="mt-1 text-xs text-ink-2">Resultado: {libre}</p>}
                  {evento.proxima_accion && <p className="mt-1 text-xs text-ink-3">Próxima acción: {evento.proxima_accion}</p>}
                  {evento.tipo === "documento_revisado" && typeof evento.detalle.motivo === "string" && (
                    <p className="mt-1 text-xs text-ink-2">
                      Motivo: {evento.detalle.motivo}
                      {typeof evento.detalle.motivo_detalle === "string" && ` · ${evento.detalle.motivo_detalle}`}
                    </p>
                  )}
                  {ES_DOCUMENTO.has(evento.tipo) && (
                    <Link to={{ search: "?tab=documentos" }} replace className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-navy hover:underline">
                      Ver en Documentos
                    </Link>
                  )}
                  {sePuedeResponder(evento) && (
                    <button type="button" onClick={() => setRespondiendo(evento.detalle.respuesta_id as number)} className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-bold text-navy hover:underline">
                      <Icono nombre="responder" size={14} /> Responder
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <ResponderCorreo respuestaId={respondiendo} onCerrar={() => setRespondiendo(null)} />
    </Tarjeta>
  );
}

// El botón sale en las respuestas que se podrían contestar; si no se puede
// por otra razón (sin clasificar, correo en no contactar…), el panel dice por qué.
function sePuedeResponder(evento: TimelineEvento) {
  if (evento.tipo !== "correo_recibido" || evento.canal !== "correo" || typeof evento.detalle.respuesta_id !== "number") return false;
  return !(evento.resultado && CLASIFICACIONES_SIN_RESPONDER.has(evento.resultado));
}
