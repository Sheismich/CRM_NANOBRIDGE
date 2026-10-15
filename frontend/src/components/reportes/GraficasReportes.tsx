import { useId } from "react";
import { compacto, plural } from "../../lib/formato";
import { diaCorto } from "../../lib/inicio";
import { nombreMesLargo } from "../../lib/reportes";
import type { ConversionEtapas, ForecastMes, ProspeccionDia } from "../../types";

// Gráficas de Reportes (docs/diseno/reportes.html, opción A), en SVG y
// CSS sin librerías. Cada una lleva sus números escritos (no solo el
// color), y la frase de arriba de su tarjeta los resume.

// Mismos colores por etapa que el tablero de Oportunidades.
const COLORES_ETAPA = ["#c57a0a", "#23bad3", "#2a449b", "#5b2d86", "#15905f", "#4f6bd6"];

export function BarrasConversion({ etapas }: { etapas: ConversionEtapas["etapas"] }) {
  const ordenadas = [...etapas].sort((a, b) => a.orden - b.orden);
  return (
    <ul className="flex flex-col gap-2.5">
      {ordenadas.map((e, i) => (
        <li key={e.etapa_clave} className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-3 text-[13px] md:grid-cols-[120px_minmax(0,1fr)_72px]">
          <span className="truncate text-ink-2">{e.etapa_nombre}</span>
          <i className="block h-[22px] overflow-hidden rounded-[7px] bg-soft">
            <s className="block h-full rounded-[7px]" style={{ width: `${Math.max(e.conversion_desde_calificada_pct ?? 0, e.oportunidades_alcanzadas > 0 ? 3 : 0)}%`, background: COLORES_ETAPA[i % COLORES_ETAPA.length] }} />
          </i>
          <b className="mono text-right text-[12px] text-strong">
            {e.oportunidades_alcanzadas} · {e.conversion_desde_calificada_pct == null ? "—" : `${Math.round(e.conversion_desde_calificada_pct)}%`}
          </b>
        </li>
      ))}
    </ul>
  );
}

// Columnas por mes: la parte clara es el valor total y la de color, lo
// ponderado por la probabilidad de su etapa.
export function ColumnasForecast({ meses }: { meses: ForecastMes[] }) {
  const maximo = Math.max(1, ...meses.map((m) => Number(m.valor_estimado_total)));
  return (
    <div>
      <div className="flex h-[190px] items-end justify-around gap-3">
        {meses.map((m) => {
          const total = Number(m.valor_estimado_total);
          const ponderado = Number(m.valor_ponderado);
          const alto = Math.max(4, (total / maximo) * 150);
          return (
            <div key={m.mes} className="flex min-w-0 flex-1 flex-col items-center gap-1.5" title={`${nombreMesLargo(m.mes)}: ${plural(m.cantidad, "oportunidad", "oportunidades")}, ${compacto.format(total)} en total y ${compacto.format(ponderado)} ponderado`}>
              <b className="mono text-[12px] text-strong">{compacto.format(total)}</b>
              <div className="relative w-full max-w-[60px] overflow-hidden rounded-t-[8px] bg-[color-mix(in_srgb,var(--navy)_22%,var(--card))]" style={{ height: alto }}>
                <span className="absolute inset-x-0 bottom-0 bg-cyan" style={{ height: `${total > 0 ? (ponderado / total) * 100 : 0}%` }} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-around gap-3 text-[12px] text-ink-3">
        {meses.map((m) => (
          <span key={m.mes} className="flex-1 text-center">
            {nombreMesLargo(m.mes).slice(0, 3)}
          </span>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[12px] text-ink-3">
        <Leyenda className="bg-[color-mix(in_srgb,var(--navy)_22%,var(--card))]">valor total</Leyenda>
        <Leyenda className="bg-cyan">ponderado</Leyenda>
      </div>
    </div>
  );
}

// Correos y respuestas por día, en el mismo eje (así se ve la proporción
// real). La línea y el área se estiran a lo ancho; el eje va aparte.
const ANCHO = 520;
const ALTO = 180;

export function LineasProspeccion({ dias }: { dias: ProspeccionDia[] }) {
  const id = useId();
  const n = dias.length;
  const tope = Math.max(1, ...dias.map((d) => Math.max(d.envios, d.respuestas)));
  const x = (i: number) => (n <= 1 ? ANCHO / 2 : (i / (n - 1)) * ANCHO);
  const y = (v: number) => ALTO - 4 - (v / tope) * (ALTO - 16);
  const linea = (valor: (d: ProspeccionDia) => number) => `M${dias.map((d, i) => `${x(i).toFixed(1)},${y(valor(d)).toFixed(1)}`).join(" L")}`;
  const envios = linea((d) => d.envios);
  const totalEnvios = dias.reduce((s, d) => s + d.envios, 0);
  const totalRespuestas = dias.reduce((s, d) => s + d.respuestas, 0);
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-[180px] w-[28px] shrink-0 text-[11px] text-ink-3" aria-hidden="true">
          <span className="mono absolute right-0 top-[12px] -translate-y-1/2">{tope}</span>
          <span className="mono absolute bottom-0 right-0">0</span>
        </div>
        <svg className="block h-[180px] min-w-0 flex-1" viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="none" role="img" aria-label={`${plural(totalEnvios, "correo enviado", "correos enviados")} y ${plural(totalRespuestas, "respuesta", "respuestas")} en el periodo`}>
          <defs>
            <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#23bad3" stopOpacity=".28" />
              <stop offset="1" stopColor="#23bad3" stopOpacity=".04" />
            </linearGradient>
          </defs>
          <line x1="0" x2={ANCHO} y1={y(0)} y2={y(0)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
          {n > 1 && <path d={`${envios} L${ANCHO},${ALTO} L0,${ALTO}Z`} fill={`url(#${id}-a)`} />}
          {n > 1 && <path d={envios} fill="none" stroke="#23bad3" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          {n > 1 && <path d={linea((d) => d.respuestas)} fill="none" stroke="#41e198" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
      {n > 1 && (
        <div className="mt-1.5 flex justify-between pl-[36px] text-[11px] text-ink-3">
          <span>{diaCorto(dias[0].fecha)}</span>
          <span>{diaCorto(dias[n - 1].fecha)}</span>
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-4 text-[12px]">
        <span className="text-info">
          ━ correos enviados <b className="mono font-extrabold">{totalEnvios}</b>
        </span>
        <span className="text-ok">
          ━ respuestas <b className="mono font-extrabold">{totalRespuestas}</b>
        </span>
      </div>
    </div>
  );
}

export function Dona({ partes, centro }: { partes: { etiqueta: string; valor: number; color: string }[]; centro: number }) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  let acumulado = 0;
  const tramos = partes.map((p) => {
    const desde = acumulado;
    acumulado += total > 0 ? (p.valor / total) * 100 : 0;
    return `${p.color} ${desde}% ${acumulado}%`;
  });
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="grid h-[120px] w-[120px] shrink-0 place-items-center rounded-full" style={{ background: total > 0 ? `conic-gradient(${tramos.join(",")})` : "var(--soft)" }}>
        <span className="mono grid h-[78px] w-[78px] place-items-center rounded-full bg-card font-display text-[26px] text-strong">{centro}</span>
      </div>
      <ul className="flex min-w-[180px] flex-1 flex-col gap-2 text-[13px]">
        {partes.map((p) => (
          <li key={p.etiqueta} className="flex items-center gap-2 text-ink-2">
            <i className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: p.color }} />
            <span className="min-w-0 flex-1 truncate">{p.etiqueta}</span>
            <b className="mono text-strong">{p.valor}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Línea chiquita de los indicadores de arriba.
export function Minigrafica({ valores, color }: { valores: number[]; color: string }) {
  if (valores.length < 2) return null;
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const rango = max - min || 1;
  const puntos = valores.map((v, i) => `${((i / (valores.length - 1)) * 100).toFixed(1)},${(24 - ((v - min) / rango) * 20).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="mt-2 block h-7 w-full" aria-hidden="true">
      <polyline points={puntos} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Leyenda({ className, children }: { className: string; children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <i className={`inline-block h-2.5 w-2.5 rounded-[3px] ${className}`} />
      {children}
    </span>
  );
}
