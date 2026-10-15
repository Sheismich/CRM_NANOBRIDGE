import { useState } from "react";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { Icono } from "../ui/Icono";
import { inputBaseClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import type { Usuario } from "../../types";

// Informe ejecutivo (docs/diseno/informe-ejecutivo.html; backend
// GET /reportes/export/informe-ejecutivo, solo administrador y
// supervisor): una hoja carta con el resumen del mes, conversión,
// forecast, prospección y desempeño por agente; el CSV trae los mismos
// números en renglones. Se elige el mes (los últimos 12) y, si se quiere,
// un agente. Va en la franja de abajo de Oportunidades (pantalla de Mich:
// solo se coloca, ver PLAN_FRONTEND.md).
//
// `enFranja` (Mich, 15-oct-2026): la versión compacta del diseño
// (capturas/oportunidades-franja.png), a la derecha de la tasa de
// conversión: etiqueta, mes, PDF y CSV. El agente es el que esté elegido en
// el filtro "Responsable" de la pantalla (`responsableId`), sin otro selector.

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function ultimosMeses(ahora: Date) {
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
    return {
      valor: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      etiqueta: `${MESES[d.getMonth()]} ${d.getFullYear()}${i === 0 ? " (este mes)" : ""}`,
      corta: `${MESES[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`
    };
  });
}

export function InformeEjecutivo({ agentes, className, enFranja = false, responsableId }: { agentes?: Usuario[]; className?: string; enFranja?: boolean; responsableId?: string }) {
  const meses = ultimosMeses(new Date());
  const [mes, setMes] = useState(meses[0].valor);
  const [elegido, setAgente] = useState("");
  const agente = enFranja ? (responsableId ?? "") : elegido;
  const [bajando, setBajando] = useState<"pdf" | "csv" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function descargar(formato: "pdf" | "csv") {
    setBajando(formato);
    setError(null);
    try {
      const qs = new URLSearchParams({ formato, mes, ...(agente ? { responsableId: agente } : {}) });
      await api.descargar(`/api/v1/reportes/export/informe-ejecutivo?${qs.toString()}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el informe");
    } finally {
      setBajando(null);
    }
  }

  if (enFranja) {
    return (
      <div className={clsx("flex flex-wrap items-center gap-2", className)}>
        <span className="font-heading text-[11px] font-extrabold uppercase tracking-[1.5px] text-ink-3">Informe ejecutivo</span>
        <select aria-label="Mes del informe" className={`${inputBaseClass} h-9 flex-[1_1_100%] py-1 text-[12.5px] md:w-auto md:flex-none`} value={mes} onChange={(e) => setMes(e.target.value)}>
          {meses.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.corta}
            </option>
          ))}
        </select>
        <Button className="!px-3.5 !py-2" disabled={bajando !== null} onClick={() => void descargar("pdf")}>
          <Icono nombre="documento" size={15} /> {bajando === "pdf" ? "Generando…" : "PDF"}
        </Button>
        <Button variant="outline" className="!px-3.5 !py-2" disabled={bajando !== null} onClick={() => void descargar("csv")}>
          <Icono nombre="descargar" size={15} /> {bajando === "csv" ? "…" : "CSV"}
        </Button>
        {error && <p className="w-full text-[12.5px] text-danger">{error}</p>}
      </div>
    );
  }

  return (
    <section className={clsx("tarjeta-blanca flex flex-wrap items-center gap-4 !rounded-[18px] px-4 py-4 md:px-5", className)}>
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[rgba(91,45,134,0.12)] text-purple">
        <Icono nombre="documento" size={20} />
      </span>
      <div className="min-w-[200px] flex-1">
        <h2 className="font-heading text-[15px] font-extrabold text-strong">Informe ejecutivo</h2>
        <p className="text-[12.5px] text-ink-3">Una hoja con el resumen del mes: pipeline, conversión, forecast, prospección y desempeño por agente.</p>
        {error && <p className="mt-1 text-[12.5px] text-danger">{error}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Mes del informe" className={`${inputBaseClass} h-10 w-auto`} value={mes} onChange={(e) => setMes(e.target.value)}>
          {meses.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.etiqueta}
            </option>
          ))}
        </select>
        {agentes && agentes.length > 0 && (
          <select aria-label="Agente" className={`${inputBaseClass} h-10 w-auto`} value={agente} onChange={(e) => setAgente(e.target.value)}>
            <option value="">Todo el equipo</option>
            {agentes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
              </option>
            ))}
          </select>
        )}
        <Button disabled={bajando !== null} onClick={() => void descargar("pdf")}>
          <Icono nombre="descargar" size={16} /> {bajando === "pdf" ? "Generando…" : "PDF"}
        </Button>
        <Button variant="outline" disabled={bajando !== null} onClick={() => void descargar("csv")}>
          <Icono nombre="descargar" size={16} /> {bajando === "csv" ? "…" : "CSV"}
        </Button>
      </div>
    </section>
  );
}
