import { useId } from "react";
import { diaCorto } from "../../lib/inicio";
import { plural } from "../../lib/formato";
import type { ProspeccionDia } from "../../types";

// "Correos enviados por día" (inicio-aprobado.html): línea menta → cyan con
// área, eje de valores a la izquierda y el número de hoy arriba a la
// derecha. La línea y el área van en un SVG que se estira a lo ancho; los
// puntos son <span> encima para que no se deformen al estirarse.
const ANCHO = 520;
const ALTO = 210;

export function GraficaCorreosPorDia({ dias, hoy }: { dias: ProspeccionDia[]; hoy: string }) {
  const id = useId();
  const valores = dias.map((d) => d.envios);
  const maximo = Math.max(0, ...valores);
  const tope = topeRedondo(maximo);
  const n = dias.length;
  // 6 de margen a los lados para que el punto de hoy no se corte en la orilla;
  // 40 arriba para que quepa la etiqueta del último día.
  const x = (i: number) => (n <= 1 ? ANCHO / 2 : 6 + (i / (n - 1)) * (ANCHO - 12));
  const y = (v: number) => ALTO - 4 - (v / tope) * (ALTO - 44);
  const puntos = dias.map((d, i) => `${x(i).toFixed(1)},${y(d.envios).toFixed(1)}`);
  const linea = `M${puntos.join(" L")}`;
  const area = `${linea} L${ANCHO},${ALTO} L0,${ALTO}Z`;
  const ultimo = dias[n - 1];
  const marcas = [tope, (tope * 2) / 3, tope / 3, 0];

  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-[210px] w-[26px] shrink-0" aria-hidden="true">
          {marcas.map((m) => (
            <span key={m} className="mono absolute right-0 -translate-y-1/2 text-[11px] text-ink-3" style={{ top: y(m) }}>
              {Math.round(m)}
            </span>
          ))}
        </div>
        <div className="relative h-[210px] min-w-0 flex-1">
          <svg className="block h-full w-full" viewBox={`0 0 ${ANCHO} ${ALTO}`} preserveAspectRatio="none" role="img" aria-label={`Correos enviados por día: ${plural(valores.reduce((a, b) => a + b, 0), "correo", "correos")} en el periodo`}>
            <defs>
              <linearGradient id={`${id}-l`} x1="0" x2="1">
                <stop offset="0" stopColor="#41e198" />
                <stop offset="1" stopColor="#23bad3" />
              </linearGradient>
              <linearGradient id={`${id}-a`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="#23bad3" stopOpacity=".35" />
                <stop offset="1" stopColor="#23bad3" stopOpacity="0" />
              </linearGradient>
            </defs>
            {marcas.map((m) => (
              <line key={m} x1="0" x2={ANCHO} y1={y(m)} y2={y(m)} stroke="var(--border)" vectorEffect="non-scaling-stroke" />
            ))}
            {n > 1 && <path d={area} fill={`url(#${id}-a)`} />}
            {n > 1 && <path d={linea} fill="none" stroke={`url(#${id}-l)`} strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
          </svg>
          {dias.map((d, i) => {
            const esUltimo = i === n - 1;
            return (
              <span
                key={d.fecha}
                title={`${diaCorto(d.fecha)}: ${plural(d.envios, "correo", "correos")}, ${plural(d.respuestas, "respuesta", "respuestas")}`}
                className={
                  esUltimo
                    ? "absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan"
                    : "absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-cyan bg-card"
                }
                style={{ left: `${(x(i) / ANCHO) * 100}%`, top: y(d.envios) }}
              />
            );
          })}
          {ultimo && (
            <b style={{ top: Math.max(0, y(ultimo.envios) - 34) }} className="mono absolute right-0 rounded-[8px] border border-border bg-card px-2 py-0.5 text-[13px] font-extrabold text-strong shadow-[0_4px_10px_-4px_rgba(0,0,0,0.25)]">
              {ultimo.envios} <small className="font-semibold text-ink-3">{ultimo.fecha === hoy ? "hoy" : diaCorto(ultimo.fecha)}</small>
            </b>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex justify-between pl-[34px] text-[11px] text-ink-3">
        {etiquetasEje(dias).map((e, i) => (
          <span key={i}>{e}</span>
        ))}
      </div>
    </div>
  );
}

// Tope del eje: el máximo redondeado hacia arriba a un múltiplo "bonito"
// de 3 marcas (3, 6, 15, 30, 60, 150...). Sin envíos, 3.
function topeRedondo(maximo: number) {
  if (maximo <= 0) return 3;
  for (const paso of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000]) {
    if (paso * 3 >= maximo) return paso * 3;
  }
  return Math.ceil(maximo / 3000) * 3000;
}

// Cuatro etiquetas: primer día con mes, dos de en medio (solo el número) y
// el último con mes. Con pocos días, las que haya.
function etiquetasEje(dias: ProspeccionDia[]) {
  const n = dias.length;
  if (n === 0) return [];
  if (n <= 2) return dias.map((d) => diaCorto(d.fecha));
  const indices = [...new Set([0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1])];
  return indices.map((i, k) => (k === 0 || k === indices.length - 1 ? diaCorto(dias[i].fecha) : String(Number(dias[i].fecha.slice(8)))));
}
