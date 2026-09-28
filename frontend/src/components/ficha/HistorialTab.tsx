import { useQuery } from "@tanstack/react-query";
import { Card, SectionTitle } from "../ui/Card";
import { api } from "../../lib/api";
import type { TimelineEvento } from "../../types";

const ETIQUETA_TIPO: Record<TimelineEvento["tipo"], string> = {
  llamada: "Llamada",
  whatsapp: "WhatsApp",
  comentario: "Comentario",
  correo_enviado: "Correo enviado",
  correo_recibido: "Respuesta recibida",
  tarea: "Tarea cerrada",
  cambio_estado_prospecto: "Cambio de estado del prospecto"
};

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
  reagendar: "Reagendar"
};

const formatoFecha = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" });

// El texto principal de cada evento vive en un campo distinto de `detalle`
// según el tipo (ver *ToEvento() en actividades.service.ts).
function textoPrincipal(evento: TimelineEvento): string | null {
  const d = evento.detalle;
  if (evento.tipo === "tarea") return typeof d.titulo === "string" ? d.titulo : null;
  if (evento.tipo === "correo_recibido") return typeof d.contenido === "string" ? d.contenido : null;
  if (evento.tipo === "cambio_estado_prospecto") return typeof d.motivo === "string" ? d.motivo : null;
  if (evento.tipo === "correo_enviado") return typeof d.numero_contacto === "number" ? `Contacto #${d.numero_contacto} de la secuencia` : null;
  return typeof d.comentario === "string" ? d.comentario : null;
}

// `resultado` no es uniforme: en respuestas es la clasificación; en
// cambio_estado_prospecto, el estado nuevo; en llamadas/WhatsApp y tareas,
// texto libre (una tarea clasificada desde la cola guarda ahí el comentario,
// y la clasificación en detalle.clasificacion -- TareasService.clasificar).
// Solo lo que es una clave se muestra como etiqueta; el texto libre, aparte.
function claveEtiqueta(evento: TimelineEvento): string | null {
  const clasificacionTarea = evento.tipo === "tarea" && typeof evento.detalle.clasificacion === "string" ? evento.detalle.clasificacion : null;
  const clave = clasificacionTarea ?? evento.resultado;
  if (clave && clave in ETIQUETA_RESULTADO) return clave;
  if (evento.tipo === "cambio_estado_prospecto") return evento.resultado;
  return null;
}

function resultadoLibre(evento: TimelineEvento): string | null {
  if (!evento.resultado || evento.tipo === "cambio_estado_prospecto" || evento.resultado in ETIQUETA_RESULTADO) return null;
  return evento.resultado;
}

function claseEtiqueta(clave: string) {
  if (clave === "interesado") return "bg-ok-bg text-ok";
  if (clave === "no_interesado" || clave === "baja" || clave === "invalido") return "bg-danger-bg text-danger";
  return "bg-bg text-ink-2";
}

export function HistorialTab({ empresaId }: { empresaId: number }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["timeline", empresaId],
    queryFn: () => api.get<{ data: TimelineEvento[] }>("/api/v1/actividades", { empresaId, limit: 100 })
  });

  return (
    <Card className="p-6">
      <SectionTitle>Historial de interacciones</SectionTitle>
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar el historial.</div>}
      {data && data.data.length === 0 && <div className="text-sm text-ink-3">Sin interacciones registradas todavía.</div>}

      {data && data.data.length > 0 && (
        <ol className="flex flex-col">
          {data.data.map((evento, i) => {
            const texto = textoPrincipal(evento);
            const clave = claveEtiqueta(evento);
            const libre = resultadoLibre(evento);
            return (
              <li key={i} className="flex gap-3.5 border-l-2 border-border pb-5 pl-4 last:pb-0">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-bold">{ETIQUETA_TIPO[evento.tipo] ?? evento.tipo}</span>
                    {AUTOMATICOS.has(evento.tipo) && <span className="rounded-full bg-bg px-2 py-0.5 text-[10px] font-semibold text-ink-3">Automático</span>}
                    {clave && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${claseEtiqueta(clave)}`}>{ETIQUETA_RESULTADO[clave] ?? clave}</span>}
                    <span className="ml-auto text-xs text-ink-3">{formatoFecha.format(new Date(evento.fecha))}</span>
                  </div>
                  {texto && <p className="mt-1 whitespace-pre-line text-[13px] text-ink-2">{texto}</p>}
                  {libre && <p className="mt-1 text-xs text-ink-2">Resultado: {libre}</p>}
                  {evento.proxima_accion && <p className="mt-1 text-xs text-ink-3">Próxima acción: {evento.proxima_accion}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
