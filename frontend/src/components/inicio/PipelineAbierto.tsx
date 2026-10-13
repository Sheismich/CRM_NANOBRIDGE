import { Link } from "react-router-dom";
import { IconoHundido } from "../ui/Tarjeta";
import { Icono } from "../ui/Icono";
import { formatoMonedaEntera as moneda, plural } from "../../lib/formato";
import type { PipelineResumen } from "../../types";

// "Pipeline abierto" del Inicio: monto grande, el renglón de oportunidades
// / ponderado / ganadas / perdidas del mes, la barra de "Probabilidad
// calculada" (ponderado ÷ pipeline) y el botón para crear una oportunidad.
// El ponderado llega del backend desde el 13-oct-2026; si todavía no está
// desplegado, la barra y el ponderado no se enseñan.
export function PipelineAbierto({ resumen, onCrear }: { resumen: PipelineResumen; onCrear: () => void }) {
  const pipeline = Number(resumen.abiertas.valor_pipeline);
  const ponderado = resumen.abiertas.valor_ponderado != null ? Number(resumen.abiertas.valor_ponderado) : null;
  const probabilidad = ponderado != null && pipeline > 0 ? Math.round((ponderado / pipeline) * 100) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3">
        <IconoHundido icono="dinero" color="morado" className="!h-11 !w-11" />
        <span className="font-heading text-[11px] font-extrabold tracking-[2px] text-ink-3">PIPELINE ABIERTO</span>
        <Link to="/oportunidades" className="ml-auto text-[12px] font-bold text-navy hover:underline">
          Ver
        </Link>
      </div>
      <div className="mono mt-4 font-display text-[40px] leading-tight text-strong md:text-[44px]">{moneda.format(pipeline)}</div>
      <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
        {plural(resumen.abiertas.cantidad, "oportunidad", "oportunidades")}
        {ponderado != null && ` · ${moneda.format(ponderado)} ponderado`} · {plural(resumen.ganadas.cantidad, "ganada", "ganadas")} ·{" "}
        {plural(resumen.perdidas.cantidad, "perdida", "perdidas")} este mes
      </p>
      {probabilidad != null && (
        <>
          <div className="mt-auto flex items-baseline justify-between pt-[18px] text-[12px] text-ink-2">
            <span>Probabilidad calculada</span>
            <b className="font-extrabold text-info">{probabilidad}%</b>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full shadow-[var(--relieve-hundido)]">
            <i className="block h-full rounded-full bg-[linear-gradient(90deg,var(--cyan),var(--marca-navy))]" style={{ width: `${probabilidad}%` }} />
          </div>
        </>
      )}
      <button
        type="button"
        onClick={onCrear}
        className="mt-[18px] flex items-center justify-center gap-2 rounded-[13px] bg-[image:var(--grad-boton)] px-4 py-[13px] text-[14px] font-extrabold text-white shadow-[0_12px_22px_-12px_rgba(42,68,155,0.85)] transition-transform hover:-translate-y-px"
      >
        <Icono nombre="mas" size={18} /> Crear nueva oportunidad
      </button>
    </div>
  );
}
