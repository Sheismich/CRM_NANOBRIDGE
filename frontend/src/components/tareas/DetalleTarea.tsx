import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import type { Tono } from "../ui/tonos";
import { inputBaseClass } from "../ui/Field";
import { ApiError } from "../../lib/api";
import { horaEvento, TEXTO_CLASIFICACION, textoContacto } from "../../lib/inicio";
import { fechaVence, grupoDe, ligaTelefono } from "../../lib/mi-dia";
import { ETIQUETA_ESTADO_TAREA, ETIQUETA_PRIORIDAD, ETIQUETA_TIPO_TAREA, asignarTarea, useHistorialTarea, useTareaDetalle } from "../../lib/tareas";
import { iniciales } from "../layout/usuario";
import type { EventoTarea, Tarea, Usuario } from "../../types";

// Detalle de una tarea en "Ver todas" (opción 6 de tareas.html): etiquetas,
// título, acciones, los cuatro datos (vence, responsable, empresa,
// contacto), el contexto (lo que contestó o la descripción) y el
// historial. En compu va a la derecha de la lista; en el celular, dentro
// de un PanelLateral.

const TONO_PRIORIDAD: Record<Tarea["prioridad"], Tono> = { urgente: "danger", alta: "warn", media: "navy", baja: "neutro" };
const TONO_ESTADO: Record<Tarea["estado"], Tono> = { pendiente: "neutro", en_progreso: "ok", cerrada: "ok", cancelada: "neutro" };

export function DetalleTarea({
  id,
  esAdminOSupervisor,
  usuarios,
  onHecha,
  onReprogramar,
  onIrACola,
  sinMarco = false
}: {
  id: number;
  esAdminOSupervisor: boolean;
  usuarios?: Usuario[];
  onHecha: (t: Tarea) => void;
  onReprogramar: (t: Tarea) => void;
  onIrACola: () => void;
  sinMarco?: boolean;
}) {
  const ahora = new Date();
  const { data: t, isPending, isError } = useTareaDetalle(id);
  const historial = useHistorialTarea(id);
  const [reasignando, setReasignando] = useState(false);

  const marco = sinMarco ? "" : "tarjeta-blanca overflow-hidden !rounded-[18px]";
  if (isPending) return <div className={clsx(marco, "p-6 text-[13px] text-ink-3")}>Cargando…</div>;
  if (isError || !t) return <div className={clsx(marco, "p-6 text-[13px] text-danger")}>No se pudo cargar la tarea.</div>;

  const abierta = t.estado === "pendiente" || t.estado === "en_progreso";
  const vencida = grupoDe(t, ahora) === "vencidas";
  const nombreDe = (uid: number | null) => (uid == null ? "Sin asignar" : (usuarios?.find((u) => u.id === uid)?.nombre ?? t.responsable_nombre ?? "—"));

  return (
    <div className={marco}>
      <div className="border-b border-border bg-[linear-gradient(120deg,var(--navy-bg),transparent_70%)] px-5 py-5 md:px-6">
        <div className="flex flex-wrap gap-2">
          <Pastilla tono={TONO_PRIORIDAD[t.prioridad]}>{ETIQUETA_PRIORIDAD[t.prioridad]}</Pastilla>
          <Pastilla tono={vencida ? "danger" : TONO_ESTADO[t.estado]}>{vencida ? "Vencida" : ETIQUETA_ESTADO_TAREA[t.estado]}</Pastilla>
          <Pastilla tono="neutro">{ETIQUETA_TIPO_TAREA[t.tipo]}</Pastilla>
        </div>
        <h2 className="mt-3 font-heading text-[20px] font-extrabold leading-snug text-strong md:text-[22px]">{t.titulo}</h2>
        {abierta && (
          <div className="mt-4 flex flex-wrap gap-2.5">
            {t.tipo === "clasificacion" ? (
              esAdminOSupervisor && (
                <Button onClick={onIrACola}>
                  <Icono nombre="flechaDerecha" size={16} /> Clasificar en la cola
                </Button>
              )
            ) : (
              <Button variant="aprobar" onClick={() => onHecha(t)}>
                <Icono nombre="check" size={16} strokeWidth={3} /> Marcar como hecha
              </Button>
            )}
            <Button variant="outline" onClick={() => onReprogramar(t)}>
              Reprogramar
            </Button>
            {esAdminOSupervisor && usuarios && (
              <Button variant="outline" onClick={() => setReasignando((v) => !v)} aria-expanded={reasignando}>
                {t.responsable_id ? "Reasignar" : "Asignar"}
              </Button>
            )}
          </div>
        )}
        {reasignando && usuarios && <Reasignar tarea={t} usuarios={usuarios} onListo={() => setReasignando(false)} />}
      </div>

      <dl className="grid grid-cols-2 gap-px border-b border-border bg-border md:grid-cols-4">
        <Dato etiqueta="Vence">
          <span className={clsx(vencida && "text-danger", grupoDe(t, ahora) === "hoy" && "text-warn")}>{fechaVence(t.fecha_limite, ahora)}</span>
        </Dato>
        <Dato etiqueta="Responsable">
          <span className="inline-flex items-center gap-1.5">
            {t.responsable_id && <Avatar nombre={nombreDe(t.responsable_id)} />}
            {nombreDe(t.responsable_id)}
          </span>
        </Dato>
        <Dato etiqueta="Empresa">
          {t.empresa_id ? (
            <Link to={`/empresas/${t.empresa_id}`} className="hover:text-navy hover:underline">
              {t.empresa_nombre ?? "Empresa"}
            </Link>
          ) : (
            "—"
          )}
        </Dato>
        <Dato etiqueta="Contacto">
          {t.contacto_nombre ?? "—"}
          {t.contacto_telefono && (
            <a href={ligaTelefono(t.contacto_telefono)} className="mono mt-0.5 block text-[12px] font-bold text-ok hover:underline">
              {t.contacto_telefono.valor}
            </a>
          )}
        </Dato>
      </dl>

      <div className="px-5 py-5 md:px-6">
        <h5 className="font-heading text-[12px] font-extrabold uppercase tracking-[1.5px] text-ink-2">Contexto</h5>
        <div className="mt-2.5 rounded-[12px] border border-border bg-soft px-4 py-3.5 text-[14px] leading-relaxed text-ink">
          {t.respuesta?.contenido ? (
            <>
              {t.campana_nombre ? `Contestó a la campaña ${t.campana_nombre}` : "Contestó"}
              {t.respuesta.clasificacion && ` (se clasificó como «${TEXTO_CLASIFICACION[t.respuesta.clasificacion] ?? t.respuesta.clasificacion}»)`}: <i>“{t.respuesta.contenido}”</i>
            </>
          ) : (
            <span className="whitespace-pre-wrap">{t.descripcion || "Sin descripción."}</span>
          )}
        </div>
        {t.resultado && (
          <>
            <h5 className="mt-5 font-heading text-[12px] font-extrabold uppercase tracking-[1.5px] text-ink-2">Resultado</h5>
            <p className="mt-2 whitespace-pre-wrap text-[14px] text-ink">{t.resultado}</p>
          </>
        )}

        <h5 className="mt-5 font-heading text-[12px] font-extrabold uppercase tracking-[1.5px] text-ink-2">Historial</h5>
        {historial.isPending && <p className="mt-2 text-[13px] text-ink-3">Cargando…</p>}
        {historial.data && (
          <ol className="ml-1.5 mt-3 border-l-2 border-border pl-[18px]">
            {historial.data.map((e, i) => (
              <li key={i} className="relative py-1.5 text-[13px] text-ink-2 before:absolute before:-left-6 before:top-[11px] before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-cyan before:bg-card">
                <b className="text-strong">{etiquetaFecha(e.fecha, ahora)}</b> · {fraseHistorial(e, nombreDe)}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function etiquetaFecha(fecha: string, ahora: Date) {
  const h = horaEvento(fecha, ahora);
  return /^\d\d:\d\d$/.test(h) ? `Hoy ${h}` : h;
}

function fraseHistorial(e: EventoTarea, nombreDe: (id: number | null) => string) {
  const quien = "usuario_nombre" in e ? (e.usuario_nombre ?? "La automatización") : "";
  switch (e.tipo) {
    case "creada":
      return "Se creó la tarea";
    case "asignada":
      return `${quien} se la asignó a ${nombreDe(e.responsable_id)}`;
    case "reprogramada":
      return `${quien} la movió ${e.fecha_limite ? `al ${new Date(e.fecha_limite).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "de fecha"}`;
    case "cerrada":
      return `${quien} la cerró${e.resultado ? `: «${e.resultado}»` : ""}`;
    case "envio":
      return `Se envió el ${textoContacto(e.numero_contacto, 1)}`;
    case "respuesta":
      return `Respondió${e.clasificacion ? `: ${TEXTO_CLASIFICACION[e.clasificacion] ?? e.clasificacion}` : " (sin clasificar)"}`;
  }
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="bg-card px-4 py-3 md:px-5">
      <dt className="text-[11px] font-bold uppercase tracking-[1px] text-ink-3">{etiqueta}</dt>
      <dd className="mt-1 text-[13.5px] font-bold text-strong">{children}</dd>
    </div>
  );
}

export function Avatar({ nombre }: { nombre: string }) {
  return <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--mint),var(--cyan))] text-[9.5px] font-extrabold text-[#06121a]">{iniciales(nombre)}</span>;
}

function Reasignar({ tarea, usuarios, onListo }: { tarea: Tarea; usuarios: Usuario[]; onListo: () => void }) {
  const queryClient = useQueryClient();
  const [a, setA] = useState(tarea.responsable_id ? String(tarea.responsable_id) : "");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function guardar() {
    if (!a) return;
    setOcupado(true);
    setError(null);
    try {
      await asignarTarea(queryClient, tarea.id, Number(a), tarea.empresa_id);
      onListo();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select aria-label="Asignar a" className={`${inputBaseClass} w-auto`} value={a} onChange={(e) => setA(e.target.value)}>
        <option value="">Elige a alguien…</option>
        {usuarios.map((u) => (
          <option key={u.id} value={u.id}>
            {u.nombre}
          </option>
        ))}
      </select>
      <Button disabled={ocupado || !a} onClick={() => void guardar()} className="px-3 py-2">
        {ocupado ? "…" : "Guardar"}
      </Button>
      {tarea.empresa_id && usuarios.find((u) => String(u.id) === a)?.rol === "agente" && (
        <span className="text-[12px] text-ink-3">Si la empresa no tiene otro agente como dueño, pasa a ser de este agente.</span>
      )}
      {error && <span className="w-full text-[12px] text-danger">{error}</span>}
    </div>
  );
}
