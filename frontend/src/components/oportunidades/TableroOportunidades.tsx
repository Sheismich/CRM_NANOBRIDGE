import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { Field, ServerError, inputClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { LogoEmpresa } from "../ui/LogoEmpresa";
import { Modal } from "../ui/Modal";
import { ApiError, api } from "../../lib/api";
import { compacto, fechaLocal, formatoDiaMes, formatoMonedaEntera } from "../../lib/formato";
import type { CatalogosOportunidad, OportunidadTablero } from "../../types";

// Tablero + embudo de Oportunidades (docs/diseno/oportunidades.html):
// arriba de cada etapa, una columna de dinero (altura = valor en la etapa,
// parte clara = ponderado por su probabilidad); abajo, sus tarjetas. Se
// arrastran entre etapas (PATCH /oportunidades/:id/etapa). Al arrastrar
// aparecen "Ganada" y "Perdida": ganar pide confirmación y perder, el
// motivo del catálogo. En el celular no se arrastra: cada tarjeta trae
// "Mover a…".

type Etapa = CatalogosOportunidad["etapas"][number];
const COLORES = ["#c57a0a", "#23bad3", "#2a449b", "#5b2d86", "#15905f", "#4f6bd6"];

export type Columna = { etapa: Etapa; oportunidades: OportunidadTablero[]; cargando: boolean; error: boolean };

export function TableroOportunidades({
  columnas,
  catalogos,
  verResponsable,
  onAbrir
}: {
  columnas: Columna[];
  catalogos: CatalogosOportunidad;
  verResponsable: boolean;
  onAbrir: (o: OportunidadTablero) => void;
}) {
  const queryClient = useQueryClient();
  const [arrastrando, setArrastrando] = useState<OportunidadTablero | null>(null);
  const [encima, setEncima] = useState<string | null>(null);
  const [porGanar, setPorGanar] = useState<OportunidadTablero | null>(null);
  const [porPerder, setPorPerder] = useState<OportunidadTablero | null>(null);
  const [moviendo, setMoviendo] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ganada = catalogos.etapas.find((e) => e.es_ganada);
  const perdida = catalogos.etapas.find((e) => e.es_cierre && !e.es_ganada);
  const maximo = Math.max(1, ...columnas.map((c) => total(c.oportunidades)));

  async function cambiar(o: OportunidadTablero, cuerpo: Record<string, string | undefined>) {
    setError(null);
    setMoviendo(o.id);
    try {
      await api.patch(`/api/v1/oportunidades/${o.id}/etapa`, cuerpo);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["oportunidades"] }),
        queryClient.invalidateQueries({ queryKey: ["oportunidad", o.id] }),
        queryClient.invalidateQueries({ queryKey: ["reportes"] })
      ]);
    } catch (err) {
      // 409: alguien más la cerró o la cambió mientras tanto.
      setError(err instanceof ApiError ? `«${o.titulo}»: ${err.message}` : "No se pudo conectar con el servidor");
      await queryClient.invalidateQueries({ queryKey: ["oportunidades"] });
    } finally {
      setMoviendo(null);
    }
  }

  function mover(o: OportunidadTablero, clave: string) {
    if (clave === o.etapa_clave) return;
    if (ganada && clave === ganada.clave) return setPorGanar(o);
    if (perdida && clave === perdida.clave) return setPorPerder(o);
    void cambiar(o, { etapaClave: clave });
  }

  const soltarEn = (clave: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!arrastrando) return;
      e.preventDefault();
      setEncima(clave);
    },
    onDragLeave: () => setEncima((actual) => (actual === clave ? null : actual)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setEncima(null);
      if (arrastrando) mover(arrastrando, clave);
      setArrastrando(null);
    }
  });

  return (
    <div className="flex flex-col gap-2.5">
      <ServerError message={error} />

      {/* Mientras se arrastra: a dónde se puede soltar para cerrarla. Flota
          abajo para no mover el tablero a media acción. */}
      {arrastrando && (
        <div className="fixed inset-x-0 bottom-6 z-40 mx-auto grid w-[min(640px,calc(100vw-32px))] grid-cols-2 gap-3 rounded-[18px] border border-border bg-card/95 p-3 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.45)] backdrop-blur">
          {ganada && (
            <div {...soltarEn(ganada.clave)} className={clsx("flex h-14 items-center justify-center gap-2 rounded-[14px] border-2 border-dashed text-[14px] font-extrabold", encima === ganada.clave ? "border-ok bg-ok-bg text-ok" : "border-ok/40 text-ok")}>
              <Icono nombre="checkCirculo" size={18} /> Soltar para marcar ganada
            </div>
          )}
          {perdida && (
            <div {...soltarEn(perdida.clave)} className={clsx("flex h-14 items-center justify-center gap-2 rounded-[14px] border-2 border-dashed text-[14px] font-extrabold", encima === perdida.clave ? "border-danger bg-danger-bg text-danger" : "border-danger/40 text-danger")}>
              <Icono nombre="xCirculo" size={18} /> Soltar para marcar perdida
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto pb-1.5 [scrollbar-width:thin]">
        <div className="min-w-[1030px] max-md:min-w-0" style={{ ["--n" as string]: columnas.length }}>
          {/* Columnas de dinero */}
          <div className="tarjeta-blanca grid grid-cols-[repeat(var(--n),minmax(196px,1fr))] gap-3.5 rounded-b-none border-b-0 px-3 pt-[18px] max-md:grid-cols-[repeat(var(--n),80vw)]">
            {columnas.map((c, i) => {
              const valor = total(c.oportunidades);
              const pond = valor * (c.etapa.probabilidad / 100);
              const alto = valor > 0 ? Math.max(8, (valor / maximo) * 100) : 0;
              const color = COLORES[i % COLORES.length];
              return (
                <div key={c.etapa.clave} className="flex flex-col gap-2 px-1.5">
                  <div className="flex items-baseline justify-between">
                    <b className="mono font-display text-[24px] font-normal text-strong">{valor > 0 ? compacto.format(valor) : "$0"}</b>
                    <span className="text-[11px] font-extrabold text-ink-3">{c.etapa.probabilidad}%</span>
                  </div>
                  <div className="text-[12px] text-ink-2">
                    ponderado <b className="text-strong">{compacto.format(pond)}</b>
                  </div>
                  <div className="relative flex h-[120px] items-end max-md:h-[90px]">
                    {valor > 0 ? (
                      <i className="relative block w-full overflow-hidden rounded-t-[12px]" style={{ height: `${alto}%`, background: `linear-gradient(180deg, ${color}, ${color}aa)` }}>
                        <span className="absolute inset-x-0 bottom-0 bg-white/30" style={{ height: `${c.etapa.probabilidad}%` }} />
                        <em className="absolute inset-x-0 top-2 text-center text-[11px] font-extrabold not-italic text-white">
                          {c.oportunidades.length} oport.
                        </em>
                      </i>
                    ) : (
                      <i className="block h-1 w-full rounded-full bg-border" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Tarjetas */}
          <div className="tarjeta-blanca grid grid-cols-[repeat(var(--n),minmax(196px,1fr))] gap-3.5 rounded-t-none border-t border-t-border p-3 max-md:grid-cols-[repeat(var(--n),80vw)]">
            {columnas.map((c, i) => (
              <div
                key={c.etapa.clave}
                {...soltarEn(c.etapa.clave)}
                className={clsx("flex min-h-[300px] flex-col gap-2.5 rounded-[18px] border bg-soft p-3 transition-colors", encima === c.etapa.clave ? "border-navy ring-2 ring-navy/30" : "border-border")}
              >
                <div className="flex items-center gap-2 px-1.5 pb-1 pt-1 font-heading text-[13px] font-extrabold text-strong">
                  <i className="h-[9px] w-[9px] rounded-full" style={{ background: COLORES[i % COLORES.length] }} />
                  <span className="min-w-0 leading-tight">{c.etapa.nombre}</span>
                  <em className="ml-auto rounded-full border border-border bg-card px-2 py-0.5 font-sans text-[11px] font-extrabold not-italic text-ink-2">{c.oportunidades.length}</em>
                </div>
                {c.cargando && <div className="px-1.5 text-xs text-ink-3">Cargando…</div>}
                {c.error && <div className="px-1.5 text-xs text-danger">No se pudo cargar.</div>}
                {c.oportunidades.map((o) => (
                  <TarjetaOportunidad
                    key={o.id}
                    oportunidad={o}
                    verResponsable={verResponsable}
                    ocupada={moviendo === o.id}
                    destinos={[...columnas.map((x) => x.etapa), ...(ganada ? [ganada] : []), ...(perdida ? [perdida] : [])]}
                    onAbrir={() => onAbrir(o)}
                    onMover={(clave) => mover(o, clave)}
                    onArrastrar={(activo) => setArrastrando(activo ? o : null)}
                  />
                ))}
                {!c.cargando && c.oportunidades.length === 0 && <div className="mt-1 rounded-[14px] border-[1.5px] border-dashed border-border p-3 text-center text-[12px] font-bold text-ink-3">Vacía</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mx-1 flex flex-wrap gap-4 text-[12px] text-ink-3">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-3.5 rounded-[3px] bg-[linear-gradient(var(--marca-navy),var(--marca-violet))]" />
          Altura = dinero en la etapa
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-3.5 rounded-[3px] bg-ink-3/40" />
          Parte clara = ponderado por probabilidad
        </span>
        <span className="hidden md:inline">· Arrastra una tarjeta para cambiarla de etapa.</span>
      </div>

      <Modal
        abierto={porGanar !== null}
        onCerrar={() => setPorGanar(null)}
        titulo="¿Marcar como ganada?"
        descripcion={porGanar ? `«${porGanar.titulo}» queda cerrada como ganada y ya no se reabre.` : undefined}
        acciones={
          <>
            <Button variant="ghost" onClick={() => setPorGanar(null)}>
              Todavía no
            </Button>
            <Button
              variant="aprobar"
              onClick={() => {
                if (porGanar && ganada) void cambiar(porGanar, { etapaClave: ganada.clave });
                setPorGanar(null);
              }}
            >
              Sí, ganada
            </Button>
          </>
        }
      />
      <Modal abierto={porPerder !== null} onCerrar={() => setPorPerder(null)} titulo="¿Por qué se perdió?" descripcion={porPerder ? `«${porPerder.titulo}» queda cerrada como perdida. Se puede reabrir después.` : undefined}>
        {porPerder && perdida && (
          <MotivoPerdida
            motivos={catalogos.motivos_perdida}
            onCancelar={() => setPorPerder(null)}
            onConfirmar={(motivo, detalle, comentario) => {
              void cambiar(porPerder, { etapaClave: perdida.clave, motivoPerdidaClave: motivo, motivoPerdidaDetalle: detalle || undefined, comentario: comentario || undefined });
              setPorPerder(null);
            }}
          />
        )}
      </Modal>
    </div>
  );
}

function total(lista: OportunidadTablero[]) {
  return lista.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0);
}

// "venció 4 oct" (rojo), "cierra 24 oct" (ámbar si es este mes) o la fecha.
function cierre(fecha: string | null) {
  if (!fecha) return { texto: "sin fecha de cierre", clase: "text-ink-3", vencida: false };
  const f = fechaLocal(fecha);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (f < hoy) return { texto: `⚠ venció ${formatoDiaMes.format(f)}`, clase: "text-danger", vencida: true };
  const esteMes = f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
  return { texto: `cierra ${formatoDiaMes.format(f)}`, clase: esteMes ? "text-warn" : "text-ink-3", vencida: false };
}

function TarjetaOportunidad({
  oportunidad: o,
  verResponsable,
  ocupada,
  destinos,
  onAbrir,
  onMover,
  onArrastrar
}: {
  oportunidad: OportunidadTablero;
  verResponsable: boolean;
  ocupada: boolean;
  destinos: Etapa[];
  onAbrir: () => void;
  onMover: (clave: string) => void;
  onArrastrar: (activo: boolean) => void;
}) {
  const c = cierre(o.fecha_cierre_estimada);
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(o.id));
        onArrastrar(true);
      }}
      onDragEnd={() => onArrastrar(false)}
      className={clsx(
        "relative cursor-grab rounded-[14px] border bg-card p-[13px] shadow-[0_1px_2px_rgba(16,23,51,0.05),0_8px_24px_-14px_rgba(16,23,51,0.18)] active:cursor-grabbing",
        c.vencida ? "border-danger/45" : "border-border",
        ocupada && "opacity-50"
      )}
    >
      <button type="button" onClick={onAbrir} className="block w-full text-left">
        <div className="flex items-center gap-2.5">
          <LogoEmpresa id={o.empresa_id} nombre={o.empresa_nombre ?? o.titulo} tamano="chico" className="!h-[30px] !w-[30px] !rounded-[9px] !text-[10px]" />
          <div className="min-w-0">
            <div className="text-[13px] font-extrabold leading-tight text-strong">{o.titulo}</div>
            <div className="truncate text-[12px] text-ink-3">{o.empresa_nombre ?? `Empresa ${o.empresa_id}`}</div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <b className="mono font-display text-[20px] font-normal text-strong">{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</b>
          {verResponsable && <span title={o.responsable_nombre ?? "Sin responsable"}><Avatar nombre={o.responsable_nombre} /></span>}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-3">
          <span>{o.dias_en_etapa == null ? "—" : o.dias_en_etapa === 1 ? "1 día en etapa" : `${o.dias_en_etapa} días en etapa`}</span>
          <span className={clsx("ml-auto font-extrabold", c.clase)}>{c.texto}</span>
        </div>
      </button>
      {/* Celular: sin arrastrar, se mueve desde aquí. */}
      <select
        aria-label={`Mover «${o.titulo}» a otra etapa`}
        className={clsx(inputClass, "mt-2.5 h-9 py-1 text-[12px] md:hidden")}
        value=""
        disabled={ocupada}
        onChange={(e) => e.target.value && onMover(e.target.value)}
      >
        <option value="">Mover a…</option>
        {destinos
          .filter((d) => d.clave !== o.etapa_clave)
          .map((d) => (
            <option key={d.clave} value={d.clave}>
              {d.es_cierre ? (d.es_ganada ? "✓ Ganada" : "✕ Perdida") : d.nombre}
            </option>
          ))}
      </select>
    </article>
  );
}

// Motivo de pérdida: del catálogo; los que lo piden (y "otro") necesitan
// explicación escrita, igual que valida el backend.
function MotivoPerdida({
  motivos,
  onCancelar,
  onConfirmar
}: {
  motivos: CatalogosOportunidad["motivos_perdida"];
  onCancelar: () => void;
  onConfirmar: (motivo: string, detalle: string, comentario: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [comentario, setComentario] = useState("");
  const [intento, setIntento] = useState(false);
  const elegido = motivos.find((m) => m.clave === motivo);
  const pideDetalle = Boolean(elegido && (elegido.requiere_explicacion || elegido.clave === "otro"));
  const errorMotivo = !motivo ? "Elige el motivo" : undefined;
  const errorDetalle = pideDetalle && detalle.trim().length < 2 ? "Explica el motivo" : undefined;

  return (
    <form
      className="flex flex-col gap-3 pb-2"
      onSubmit={(e) => {
        e.preventDefault();
        setIntento(true);
        if (!errorMotivo && !errorDetalle) onConfirmar(motivo, detalle.trim(), comentario.trim());
      }}
    >
      <div className="flex flex-wrap gap-1.5">
        {motivos.map((m) => (
          <button
            key={m.clave}
            type="button"
            onClick={() => setMotivo(m.clave)}
            aria-pressed={motivo === m.clave}
            className={clsx("rounded-full border px-3 py-1.5 text-[12px] font-bold", motivo === m.clave ? "border-danger bg-danger-bg text-danger" : "border-border bg-card text-ink-2 hover:text-strong")}
          >
            {m.nombre}
          </button>
        ))}
      </div>
      {intento && errorMotivo && <span className="text-xs text-danger">{errorMotivo}</span>}
      {pideDetalle && (
        <Field label="Explícalo" htmlFor="perdida-detalle" error={intento ? errorDetalle : undefined}>
          <textarea id="perdida-detalle" rows={2} maxLength={500} className={inputClass} value={detalle} onChange={(e) => setDetalle(e.target.value)} />
        </Field>
      )}
      <Field label="Comentario (opcional)" htmlFor="perdida-comentario">
        <input id="perdida-comentario" maxLength={500} className={inputClass} value={comentario} onChange={(e) => setComentario(e.target.value)} />
      </Field>
      <div className="flex justify-end gap-2.5 pt-1">
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        <Button type="submit" variant="rechazar">
          Marcar perdida
        </Button>
      </div>
    </form>
  );
}
