import { clsx } from "clsx";
import { Avatar } from "../ui/Avatar";
import { LogoEmpresa } from "../ui/LogoEmpresa";
import { COLOR_TONO, type Tono } from "../ui/tonos";
import { TONO_ESTADO_COTIZACION, avisoCotizacion } from "../../lib/cotizaciones";
import { formatoMonedaEntera } from "../../lib/formato";
import type { CotizacionTablero, EstadoCotizacion } from "../../types";

// Tablero por estado de Cotizaciones (docs/diseno/cotizaciones.html,
// opción B): una columna por estado con su cuenta y su monto, y tarjetas
// con el aviso de seguimiento ("Sin respuesta hace 5 días", "Vence en 2
// días"). Aquí no se arrastra: el estado se cambia desde el documento, que
// es donde se ve qué se está aceptando o rechazando. Con un estado elegido
// arriba, su columna ocupa todo el ancho.

export type ColumnaCotizaciones = {
  estado: EstadoCotizacion;
  titulo: string;
  cotizaciones: CotizacionTablero[];
  cuenta: { cantidad: number; total: number } | undefined;
  cargando: boolean;
  error: boolean;
  // Llegó el tope de la consulta: puede haber más que no se ven.
  cortada: boolean;
};

const TEXTO_TONO: Record<Tono, string> = {
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
  info: "text-info",
  navy: "text-navy",
  neutro: "text-ink-3"
};

export function TableroCotizaciones({
  columnas,
  verResponsable,
  nombreMotivo,
  onAbrir,
  onNueva
}: {
  columnas: ColumnaCotizaciones[];
  verResponsable: boolean;
  nombreMotivo: (clave: string) => string;
  onAbrir: (c: CotizacionTablero) => void;
  onNueva: () => void;
}) {
  const sola = columnas.length === 1;
  return (
    <div className="overflow-x-auto pb-1.5 [scrollbar-width:thin]">
      <div
        className={clsx("grid gap-3.5", sola ? "grid-cols-1" : "grid-cols-[repeat(var(--n),minmax(220px,1fr))] max-md:grid-cols-[repeat(var(--n),80vw)]")}
        style={{ ["--n" as string]: columnas.length }}
      >
        {columnas.map((col) => (
          <section key={col.estado} className="flex min-h-[360px] flex-col gap-2.5 rounded-[18px] border border-border bg-soft p-3">
            <h3 className="flex items-center gap-2 px-1.5 pb-1 pt-1 font-heading text-[13px] font-extrabold text-strong">
              <i className={clsx("h-2.5 w-2.5 rounded-full", COLOR_TONO[TONO_ESTADO_COTIZACION[col.estado]])} />
              {col.titulo}
              <em className="ml-auto font-sans text-[12px] font-bold not-italic text-ink-3">
                {col.cuenta ? `${col.cuenta.cantidad} · ${formatoMonedaEntera.format(col.cuenta.total)}` : "…"}
              </em>
            </h3>
            {col.cargando && <div className="px-1.5 text-xs text-ink-3">Cargando…</div>}
            {col.error && <div className="px-1.5 text-xs text-danger">No se pudo cargar.</div>}
            <div className={clsx("flex flex-col gap-2.5", sola && "md:grid md:grid-cols-2 xl:grid-cols-3")}>
              {col.cotizaciones.map((c) => (
                <TarjetaCotizacion key={c.id} cotizacion={c} verResponsable={verResponsable} nombreMotivo={nombreMotivo} onAbrir={() => onAbrir(c)} />
              ))}
            </div>
            {!col.cargando && !col.error && col.cotizaciones.length === 0 && col.estado !== "borrador" && (
              <div className="mt-1 rounded-[14px] border-[1.5px] border-dashed border-border p-3 text-center text-[12px] font-bold text-ink-3">Ninguna</div>
            )}
            {col.cortada && <div className="px-1.5 text-[12px] text-ink-3">Se ven las {col.cotizaciones.length} más recientes. Busca para encontrar otra.</div>}
            {col.estado === "borrador" && (
              <button type="button" onClick={onNueva} className="rounded-[14px] border-[1.5px] border-dashed border-border p-3 text-center text-[13px] font-bold text-ink-3 hover:border-navy/40 hover:text-strong">
                + Nueva cotización
              </button>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

function TarjetaCotizacion({ cotizacion: c, verResponsable, nombreMotivo, onAbrir }: { cotizacion: CotizacionTablero; verResponsable: boolean; nombreMotivo: (clave: string) => string; onAbrir: () => void }) {
  const aviso = avisoCotizacion(c, nombreMotivo);
  const empresa = c.empresa_nombre ?? `Empresa ${c.empresa_id}`;
  return (
    <button
      type="button"
      onClick={onAbrir}
      className={clsx(
        "block w-full rounded-[14px] border bg-card p-3.5 text-left shadow-[0_1px_2px_rgba(16,23,51,0.05),0_8px_24px_-14px_rgba(16,23,51,0.18)] transition hover:-translate-y-px hover:border-info",
        aviso.urgente ? "border-danger/45" : "border-border"
      )}
    >
      <div className="flex items-center gap-2.5">
        <LogoEmpresa id={c.empresa_id} nombre={empresa} tamano="chico" className="!h-[30px] !w-[30px] !rounded-[9px] !text-[10px]" />
        <div className="min-w-0">
          <div className="truncate text-[14px] font-extrabold leading-tight text-strong">{empresa}</div>
          <div className="truncate text-[12px] text-ink-2">
            #{c.id} v{c.version} · {c.oportunidad_titulo ?? `Oportunidad ${c.oportunidad_id}`}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <b className="mono font-display text-[18px] font-normal text-strong">{formatoMonedaEntera.format(Number(c.total))}</b>
        {verResponsable && (
          <span className="ml-auto" title={c.responsable_nombre ?? "Sin responsable"}>
            <Avatar nombre={c.responsable_nombre} />
          </span>
        )}
      </div>
      <div className={clsx("mt-1.5 text-[12px] font-bold", TEXTO_TONO[aviso.tono])}>{aviso.texto}</div>
    </button>
  );
}
