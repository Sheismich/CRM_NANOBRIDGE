import { useState } from "react";
import { etiquetaMes, formatoMonedaEntera } from "../../lib/formato";
import type { ConversionEtapas, ForecastMes } from "../../types";

// Colores de serie de las gráficas, validados con el script de la guía de
// visualización (separación para daltonismo y banda de luminosidad sobre
// fondo blanco). El navy de marca (--navy) queda fuera de la banda (muy
// oscuro), por eso la serie usa un azul un paso más claro. El cian tiene
// poco contraste contra el blanco: cada gráfica lleva sus valores en una
// tabla o etiqueta visible, nunca solo en el color.
const SERIE_NOMINAL = "#4a67c9";
const SERIE_PONDERADO = "#23bad3";

const formatoCompacto = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", notation: "compact", maximumFractionDigits: 1 });

// Tope "redondo" del eje (1, 1.2, 1.5, 2… × 10^n) para que las marcas del
// eje (cuartos del tope) sean números limpios sin dejar media gráfica vacía.
function topeRedondo(max: number) {
  if (max <= 0) return 1;
  const potencia = 10 ** Math.floor(Math.log10(max));
  const paso = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((m) => m * potencia >= max) ?? 10;
  return paso * potencia;
}

// Forecast mensual: monto nominal vs. ponderado por probabilidad, por mes
// de cierre estimado. Mismas unidades (MXN) en las dos series, un solo eje.
export function GraficaForecast({ meses }: { meses: ForecastMes[] }) {
  const [activo, setActivo] = useState<string | null>(null);
  const tope = topeRedondo(Math.max(...meses.map((m) => Number(m.valor_estimado_total))));
  const marcas = [0, 0.25, 0.5, 0.75, 1].map((f) => f * tope);
  const alto = 180;

  return (
    <div>
      <div className="mb-6 flex gap-4 text-xs text-ink-2">
        <Leyenda color={SERIE_NOMINAL} texto="Monto estimado" />
        <Leyenda color={SERIE_PONDERADO} texto="Ponderado por probabilidad" />
      </div>
      <div className="flex">
        <div className="relative mr-2 w-14 shrink-0" style={{ height: alto }}>
          {marcas.map((v) => (
            <span key={v} className="absolute right-0 -translate-y-1/2 text-[10px] text-ink-3" style={{ bottom: `${(v / tope) * 100}%` }}>
              {formatoCompacto.format(v)}
            </span>
          ))}
        </div>
        <div className="relative flex-1" style={{ height: alto }}>
          {marcas.map((v) => (
            <div key={v} className="absolute inset-x-0 h-px bg-border" style={{ bottom: `${(v / tope) * 100}%` }} />
          ))}
          <div className="absolute inset-0 flex items-end justify-around">
            {meses.map((m) => (
              <div
                key={m.mes}
                tabIndex={0}
                aria-label={`${etiquetaMes(m.mes)}: estimado ${formatoMonedaEntera.format(Number(m.valor_estimado_total))}, ponderado ${formatoMonedaEntera.format(Number(m.valor_ponderado))}`}
                className="relative flex h-full flex-1 items-end justify-center gap-0.5 outline-none"
                onPointerEnter={() => setActivo(m.mes)}
                onPointerLeave={() => setActivo(null)}
                onFocus={() => setActivo(m.mes)}
                onBlur={() => setActivo(null)}
              >
                <Columna valor={Number(m.valor_estimado_total)} tope={tope} color={SERIE_NOMINAL} />
                <Columna valor={Number(m.valor_ponderado)} tope={tope} color={SERIE_PONDERADO} />
                {activo === m.mes && (
                  <div className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-[9px] border border-border bg-white px-3 py-2 text-xs shadow-[0_8px_20px_rgba(21,28,54,0.12)]">
                    <div className="mb-1 font-semibold text-ink-2">
                      {etiquetaMes(m.mes)} · {m.cantidad} oportunidad{m.cantidad === 1 ? "" : "es"}
                    </div>
                    <FilaTooltip color={SERIE_NOMINAL} valor={formatoMonedaEntera.format(Number(m.valor_estimado_total))} texto="estimado" />
                    <FilaTooltip color={SERIE_PONDERADO} valor={formatoMonedaEntera.format(Number(m.valor_ponderado))} texto="ponderado" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ml-16 flex justify-around pt-1.5">
        {meses.map((m) => (
          <span key={m.mes} className="flex-1 text-center text-[11px] text-ink-3">
            {etiquetaMes(m.mes)}
          </span>
        ))}
      </div>
    </div>
  );
}

function Columna({ valor, tope, color }: { valor: number; tope: number; color: string }) {
  return <div className="w-full max-w-6 rounded-t-[4px]" style={{ height: `${(valor / tope) * 100}%`, background: color }} />;
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {texto}
    </span>
  );
}

function FilaTooltip({ color, valor, texto }: { color: string; valor: string; texto: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />
      <span className="font-bold text-ink">{valor}</span>
      <span className="text-ink-3">{texto}</span>
    </div>
  );
}

// Conversión por etapa: cuántas oportunidades llegaron a cada etapa del
// embudo y qué porcentaje son de las que entraron como "calificada". Una
// sola serie: sin leyenda, el título de la tarjeta dice qué se grafica.
export function GraficaConversion({ datos }: { datos: ConversionEtapas }) {
  const max = Math.max(1, ...datos.etapas.map((e) => e.oportunidades_alcanzadas));
  return (
    <div className="flex flex-col gap-2.5">
      {datos.etapas.map((e) => (
        <div key={e.etapa_clave} className="grid grid-cols-[130px_1fr] items-center gap-3">
          <span className="truncate text-xs text-ink-2" title={e.etapa_nombre}>
            {e.etapa_nombre}
          </span>
          <div className="flex items-center gap-2">
            <div className="h-4 rounded-r-[4px]" style={{ width: `${(e.oportunidades_alcanzadas / max) * 80}%`, minWidth: e.oportunidades_alcanzadas > 0 ? 3 : 0, background: SERIE_NOMINAL }} />
            <span className="whitespace-nowrap text-xs text-ink">
              <span className="font-bold">{e.oportunidades_alcanzadas}</span>
              {e.conversion_desde_calificada_pct != null && <span className="text-ink-3"> · {e.conversion_desde_calificada_pct}%</span>}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
