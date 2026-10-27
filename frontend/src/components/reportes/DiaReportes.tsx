import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Avatar } from "../ui/Avatar";
import { Icono } from "../ui/Icono";
import type { NombreIcono } from "../ui/iconos";
import { BotonCsv, TarjetaReporte } from "./piezas";
import { api } from "../../lib/api";
import { plural } from "../../lib/formato";
import { isoDia } from "../../lib/inicio";
import { fechaLarga, horaLocal, moverDia } from "../../lib/reportes";
import type { MovimientoDia, ReporteDia, TipoBitacora } from "../../types";

// Reportes · Día (docs/diseno/reportes.html, "Día"; GET /reportes/dia):
// todo lo que pasó en el CRM un día, en orden de hora. Arriba los números
// del día y lo que hay que revisar; la bitácora con filtro por tipo; a la
// derecha, por persona y lo que quedó pendiente. Un agente solo ve lo
// suyo (lo filtra el backend); admin y supervisor eligen la persona arriba.

const TIPOS: { id: "todo" | TipoBitacora; texto: string }[] = [
  { id: "todo", texto: "Todo" },
  { id: "tareas", texto: "Tareas" },
  { id: "correos", texto: "Correos" },
  { id: "respuestas", texto: "Respuestas" },
  { id: "bajas", texto: "Bajas" },
  { id: "documentos", texto: "Documentos" },
  { id: "sistema", texto: "Sistema" }
];
const POR_PAGINA = 50;
const TOPE = 200;

type Aspecto = { icono: NombreIcono; color: string; incidencia?: boolean };

function aspecto(m: MovimientoDia): Aspecto {
  if (m.subtipo === "vencida") return { icono: "reloj", color: "text-danger border-danger", incidencia: true };
  if (m.subtipo === "fallo") return { icono: "aviso", color: "text-danger border-danger", incidencia: true };
  if (m.tipo === "sistema") return { icono: "servidor", color: "text-ink-3 border-ink-3" };
  if (m.tipo === "tareas") {
    if (m.subtipo === "cerrada") return { icono: "checkCirculo", color: "text-ok border-ok" };
    if (m.subtipo === "creada") return { icono: "mas", color: "text-navy border-navy" };
    if (m.subtipo === "reprogramada") return { icono: "calendario", color: "text-warn border-warn" };
    return { icono: "persona", color: "text-navy border-navy" };
  }
  if (m.tipo === "correos") return { icono: "correo", color: "text-info border-info" };
  if (m.tipo === "respuestas") return { icono: "campana", color: "text-ok border-ok" };
  if (m.tipo === "bajas") return { icono: "xCirculo", color: "text-danger border-danger" };
  return { icono: "documento", color: "text-purple border-purple" };
}

const mayuscula = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const primerNombre = (n: string) => n.split(/\s+/)[0] ?? n;

// "Fabián cerró …"; sin persona, el texto del backend con mayúscula, y el
// nombre del contacto en negritas si va al principio.
function frase(m: MovimientoDia): ReactNode {
  if (m.usuario_nombre) {
    return (
      <>
        <b>{primerNombre(m.usuario_nombre)}</b> {m.texto}
      </>
    );
  }
  if (m.contacto_nombre && m.texto.startsWith(m.contacto_nombre)) {
    return (
      <>
        <b>{m.contacto_nombre}</b>
        {m.texto.slice(m.contacto_nombre.length)}
      </>
    );
  }
  return mayuscula(m.texto);
}

function quien(m: MovimientoDia) {
  if (m.tipo === "sistema") return "Sistema";
  if (m.subtipo === "vencida") return m.responsable_nombre ?? "Sin asignar";
  if (!m.usuario_id && (m.tipo === "correos" || m.tipo === "tareas")) return "Automatización";
  return null;
}

export function DiaReportes({ fecha, onFecha, usuarioId, esAdmin, esAdminOSupervisor }: { fecha: string; onFecha: (f: string) => void; usuarioId?: number; esAdmin: boolean; esAdminOSupervisor: boolean }) {
  const [tipo, setTipo] = useState<"todo" | TipoBitacora>("todo");
  const [limite, setLimite] = useState(POR_PAGINA);
  const hoy = isoDia(new Date());

  const params = { fecha, tipo, usuarioId, limit: limite };
  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: ["reportes", "dia", params],
    queryFn: () => api.get<ReporteDia>("/api/v1/reportes/dia", params),
    placeholderData: keepPreviousData
  });

  function irA(f: string) {
    setLimite(POR_PAGINA);
    onFecha(f > hoy ? hoy : f);
  }

  const r = data?.resumen;
  const esHoy = fecha === hoy;
  const pendientes = data?.para_revisar;
  const porRevisar = (pendientes?.vencidas_sin_cerrar ?? 0) + (pendientes?.avisos_fallidos ?? 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="tarjeta-blanca flex items-center gap-1 !rounded-[14px] px-1.5 py-1">
          <button type="button" aria-label="Día anterior" onClick={() => irA(moverDia(fecha, -1))} className="grid h-9 w-9 place-items-center rounded-full text-ink-2 hover:bg-soft hover:text-strong">
            <Icono nombre="flechaIzquierda" size={16} />
          </button>
          <label className="relative flex cursor-pointer items-center gap-2 px-2 font-heading text-[14px] font-extrabold text-strong md:text-[15px]">
            <Icono nombre="calendario" size={16} className="text-navy" />
            {fechaLarga(fecha)}
            <input type="date" aria-label="Elegir día" max={hoy} value={fecha} onChange={(e) => e.target.value && irA(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
          </label>
          <button type="button" aria-label="Día siguiente" disabled={esHoy} onClick={() => irA(moverDia(fecha, 1))} className="grid h-9 w-9 place-items-center rounded-full text-ink-2 hover:bg-soft hover:text-strong disabled:opacity-30">
            <Icono nombre="flechaDerecha" size={16} />
          </button>
        </div>
        {!esHoy && (
          <button type="button" onClick={() => irA(hoy)} className="tarjeta-blanca h-11 !rounded-[12px] px-4 text-[13px] font-extrabold text-strong">
            Hoy
          </button>
        )}
        <span className="text-[13px] text-ink-3 md:ml-auto">Todo lo que pasó en el CRM ese día, en orden de hora.</span>
      </div>

      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar el día.</div>}

      {data && r && (
        <>
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))] md:gap-3">
            {r.correos && (
              <Numero etiqueta="Correos enviados" valor={r.correos.enviados}>
                {r.correos.enviados > 0 ? `${plural(r.correos.campanas, "campaña", "campañas")}${r.correos.ultimo_en ? ` · último ${horaLocal(r.correos.ultimo_en)}` : ""}` : "ninguno"}
              </Numero>
            )}
            {r.respuestas && (
              <Numero etiqueta="Respuestas" valor={r.respuestas.recibidas} tono={r.respuestas.interesados > 0 ? "ok" : undefined}>
                {plural(r.respuestas.interesados, "interesado", "interesados")}
              </Numero>
            )}
            <Numero etiqueta="Tareas cerradas" valor={r.tareas_cerradas.cerradas}>
              de {r.tareas_cerradas.vencian_ese_dia} que vencían {esHoy ? "hoy" : "ese día"}
            </Numero>
            <Numero etiqueta="Tareas creadas" valor={r.tareas_creadas.creadas}>
              {r.tareas_creadas.por_automatizacion} por la automatización
            </Numero>
            {r.bajas && (
              <Numero etiqueta="Bajas" valor={r.bajas.total} tono={r.bajas.total > 0 ? "danger" : undefined}>
                {r.bajas.ultima ? `${r.bajas.ultima.contacto_nombre} · ${horaLocal(r.bajas.ultima.fecha)}` : "ninguna"}
              </Numero>
            )}
          </div>

          {porRevisar > 0 && pendientes && (
            <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-warn/40 bg-warn-bg px-4 py-3.5 text-[13px]">
              <Icono nombre="aviso" size={18} className="shrink-0 text-warn" />
              <div className="min-w-0 flex-1">
                <b className="text-strong">{plural(porRevisar, "cosa para revisar", "cosas para revisar")} de este día</b>
                <p className="text-ink-2">
                  {[
                    pendientes.vencidas_sin_cerrar > 0 && `${plural(pendientes.vencidas_sin_cerrar, "tarea venció", "tareas vencieron")} y no se cerró${pendientes.vencidas_sin_cerrar === 1 ? "" : "n"}`,
                    pendientes.avisos_fallidos ? `${plural(pendientes.avisos_fallidos, "aviso a n8n falló", "avisos a n8n fallaron")}` : null
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              {esAdmin && pendientes.avisos_fallidos ? (
                <Link to="/administracion" className="font-extrabold text-warn hover:underline">
                  Ver en Administración
                </Link>
              ) : null}
            </div>
          )}

          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
            <TarjetaReporte
              titulo="Bitácora del día"
              subtitulo={plural(data.bitacora.total, "movimiento", "movimientos")}
              extra={esAdminOSupervisor && <BotonCsv reporte="dia" filtros={{ fecha, tipo, usuarioId }} />}
            >
              <div className="-mt-1 mb-4 flex flex-wrap gap-1.5">
                {TIPOS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={tipo === t.id}
                    onClick={() => {
                      setTipo(t.id);
                      setLimite(POR_PAGINA);
                    }}
                    className={clsx("rounded-full border px-3 py-1.5 text-[12px] font-bold", tipo === t.id ? "border-strong bg-strong text-card" : "border-border bg-card text-ink-2 hover:text-strong")}
                  >
                    {t.texto}
                  </button>
                ))}
              </div>
              {data.bitacora.data.length === 0 ? (
                <p className="py-6 text-center text-[13px] text-ink-3">{tipo === "todo" ? "No hubo movimientos ese día." : "No hubo movimientos de este tipo ese día."}</p>
              ) : (
                <ol className={clsx("relative flex flex-col gap-1", isFetching && "opacity-60")}>
                  <span aria-hidden="true" className="absolute bottom-3 left-[70px] top-3 w-px bg-border md:left-[74px]" />
                  {data.bitacora.data.map((m, i) => (
                    <Movimiento key={`${m.tipo}-${m.subtipo}-${m.entidad?.id ?? ""}-${m.fecha}-${i}`} m={m} esAdmin={esAdmin} />
                  ))}
                </ol>
              )}
              {data.bitacora.total > data.bitacora.data.length && (
                <div className="mt-3 border-t border-border pt-3 text-center text-[13px] font-extrabold text-info">
                  {limite < TOPE ? (
                    <button type="button" onClick={() => setLimite((l) => Math.min(TOPE, l + POR_PAGINA))} className="hover:underline">
                      Ver {plural(Math.min(POR_PAGINA, data.bitacora.total - data.bitacora.data.length), "movimiento anterior", "movimientos anteriores")}
                    </button>
                  ) : (
                    <span className="font-semibold text-ink-3">
                      Hay {data.bitacora.total - data.bitacora.data.length} más{esAdminOSupervisor ? ": descarga el CSV para verlos todos." : "."}
                    </span>
                  )}
                </div>
              )}
            </TarjetaReporte>

            <div className="flex flex-col gap-4">
              <TarjetaReporte titulo="Por persona" subtitulo="ese día">
                {data.por_persona.length === 0 && !data.automatizacion && <p className="text-[13px] text-ink-3">Nadie movió nada ese día.</p>}
                <ul className="flex flex-col divide-y divide-border">
                  {data.por_persona.map((p) => (
                    <li key={p.usuario_id} className="flex items-center gap-3 py-3 first:pt-0">
                      <Avatar nombre={p.nombre} className="!h-9 !w-9 !text-[11px]" />
                      <div className="min-w-0 flex-1">
                        <b className="block truncate text-[13.5px] text-strong">{p.nombre ?? "—"}</b>
                        <small className="flex items-center gap-1 text-[12px] text-ink-3">
                          <Icono nombre="reloj" size={12} />
                          {p.primera_accion && p.ultima_accion ? `${horaLocal(p.primera_accion)} – ${horaLocal(p.ultima_accion)}` : "sin acciones"}
                        </small>
                      </div>
                      <Cifra valor={p.tareas_que_cerro} texto={p.tareas_que_cerro === 1 ? "cerrada" : "cerradas"} />
                      {p.tomadas > 0 && <Cifra valor={p.tomadas} texto={p.tomadas === 1 ? "tomada" : "tomadas"} />}
                      <Cifra valor={p.vencidas} texto={p.vencidas === 1 ? "vencida" : "vencidas"} rojo={p.vencidas > 0} />
                    </li>
                  ))}
                  {data.automatizacion && (
                    <li className="flex items-center gap-3 py-3 first:pt-0">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-soft text-ink-2">
                        <Icono nombre="servidor" size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <b className="block text-[13.5px] text-strong">Automatización</b>
                        <small className="text-[12px] text-ink-3">correos, clasificación y tareas</small>
                      </div>
                      <Cifra valor={data.automatizacion.correos} texto="correos" />
                      <Cifra valor={data.automatizacion.tareas_creadas} texto="tareas" />
                    </li>
                  )}
                </ul>
              </TarjetaReporte>

              <TarjetaReporte titulo="Quedó pendiente" subtitulo="vencía ese día y no se cerró">
                {data.quedo_pendiente.length === 0 ? (
                  <p className="text-[13px] text-ink-3">{esHoy ? "Nada vencido sin cerrar por ahora." : "Nada: todo lo que vencía se cerró a tiempo."}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {data.quedo_pendiente.map((t) => (
                      <li key={t.tarea_id} className="flex items-center gap-3 py-3 first:pt-0">
                        <i className={clsx("h-2 w-2 shrink-0 rounded-full", t.estado === "cerrada" ? "bg-warn" : "bg-danger")} />
                        <div className="min-w-0 flex-1">
                          <b className="block truncate text-[13.5px] text-strong">{t.titulo}</b>
                          <small className="text-[12px] text-ink-3">
                            {t.responsable_nombre ?? "Sin asignar"} · {t.estado === "cerrada" ? "se cerró después" : `venció ${horaLocal(t.fecha_limite)}`}
                          </small>
                        </div>
                        <Link to={esAdminOSupervisor ? "/tareas?vista=todas" : "/tareas"} className="text-[12px] font-extrabold text-info hover:underline">
                          Abrir
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </TarjetaReporte>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Numero({ etiqueta, valor, tono, children }: { etiqueta: string; valor: number; tono?: "ok" | "danger"; children: ReactNode }) {
  return (
    <div className="tarjeta-blanca min-w-0 !rounded-[16px] px-4 py-3.5">
      <small className="block font-heading text-[10.5px] font-extrabold uppercase leading-snug tracking-[0.8px] text-ink-3 md:text-[11px] md:tracking-[1.2px]">{etiqueta}</small>
      <b className="mono mt-1 block font-display text-[30px] font-normal leading-tight text-strong">{valor}</b>
      <span className={clsx("block truncate text-[12px]", tono === "ok" ? "font-bold text-ok" : tono === "danger" ? "font-bold text-danger" : "text-ink-2")}>{children}</span>
    </div>
  );
}

function Cifra({ valor, texto, rojo }: { valor: number; texto: string; rojo?: boolean }) {
  return (
    <span className="w-[54px] shrink-0 text-center">
      <b className={clsx("mono block font-display text-[20px] font-normal leading-none", rojo ? "text-danger" : "text-strong")}>{valor}</b>
      <small className="text-[10.5px] text-ink-3">{texto}</small>
    </span>
  );
}

function Movimiento({ m, esAdmin }: { m: MovimientoDia; esAdmin: boolean }) {
  const a = aspecto(m);
  const deQuien = quien(m);
  return (
    <li className="relative grid grid-cols-[44px_32px_minmax(0,1fr)] items-start gap-2.5 py-2 md:grid-cols-[48px_32px_minmax(0,1fr)]">
      <span className="mono pt-1.5 text-right text-[13px] font-extrabold text-strong">{horaLocal(m.fecha)}</span>
      <span className={clsx("relative z-[1] grid h-8 w-8 place-items-center rounded-full border-[1.5px] bg-card", a.color)}>
        <Icono nombre={a.icono} size={15} />
      </span>
      <div className={clsx("min-w-0 text-[13.5px] text-ink", a.incidencia && "rounded-[12px] bg-danger-bg px-3 py-2")}>
        <p className="leading-snug [&_b]:font-extrabold [&_b]:text-strong">{frase(m)}</p>
        {/* Sobre el fondo rojo de una incidencia, ink-3 no llega a 4.5:1 de noche. */}
        <small className={clsx("mt-0.5 block text-[12px]", a.incidencia ? "text-ink-2" : "text-ink-3")}>
          {[
            m.empresa_id && m.empresa_nombre ? (
              <Link key="e" to={`/empresas/${m.empresa_id}`} className="hover:text-info hover:underline">
                {m.empresa_nombre}
              </Link>
            ) : null,
            deQuien,
            m.subtipo === "fallo" && esAdmin ? (
              <Link key="a" to="/administracion" className="font-bold text-info hover:underline">
                Ver detalle
              </Link>
            ) : null
          ]
            .filter(Boolean)
            .flatMap((x, i) => (i > 0 ? [" · ", x] : [x]))}
        </small>
      </div>
    </li>
  );
}
