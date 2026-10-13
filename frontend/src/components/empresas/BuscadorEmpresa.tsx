import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Icono } from "../ui/Icono";
import { inputClass } from "../ui/Field";
import { api } from "../../lib/api";
import type { Empresa, Paginated } from "../../types";

// "¿De qué empresa es?": busca con GET /empresas?q= (un agente solo ve las
// suyas) y devuelve la elegida. Lo usan "Crear nueva oportunidad" del
// Inicio y "Subir documento" de Documentos.
export function BuscadorEmpresa({ pregunta = "¿De qué empresa es?", onElegir }: { pregunta?: string; onElegir: (e: Empresa) => void }) {
  const [busqueda, setBusqueda] = useState("");
  const q = busqueda.trim();
  const { data: empresas, isFetching } = useQuery({
    queryKey: ["empresas", "buscar", q],
    queryFn: () => api.get<Paginated<Empresa>>("/api/v1/empresas", { q: q || undefined, limit: 8, orden: "actividad" })
  });

  return (
    <div>
      <label htmlFor="buscar-empresa" className="text-[13px] font-bold text-strong">
        {pregunta}
      </label>
      <input id="buscar-empresa" data-autofocus placeholder="Busca por nombre…" className={`${inputClass} mt-2`} value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
      <ul className="mt-3 flex flex-col gap-1.5">
        {(empresas?.data ?? []).map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onElegir(e)}
              className="flex w-full items-center gap-2.5 rounded-[12px] border border-border bg-card px-3 py-2.5 text-left text-[13px] hover:border-navy/40"
            >
              <Icono nombre="empresa" size={16} className="shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1">
                <b className="block truncate text-strong">{e.nombre_comercial ?? e.nombre_legal}</b>
                {[e.giro, e.ciudad].filter(Boolean).length > 0 && <small className="text-[12px] text-ink-3">{[e.giro, e.ciudad].filter(Boolean).join(" · ")}</small>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!isFetching && empresas && empresas.data.length === 0 && <p className="mt-3 text-[13px] text-ink-2">{q ? "Ninguna empresa con ese nombre." : "Todavía no tienes empresas."}</p>}
    </div>
  );
}

// La empresa ya elegida, con "Cambiar" para volver al buscador.
export function EmpresaElegida({ empresa, onCambiar }: { empresa: Empresa; onCambiar: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-[13px] md:px-5">
      <Icono nombre="empresa" size={16} className="text-ink-3" />
      <b className="min-w-0 flex-1 truncate text-strong">{empresa.nombre_comercial ?? empresa.nombre_legal}</b>
      <button type="button" onClick={onCambiar} className="text-[12px] font-bold text-navy hover:underline">
        Cambiar
      </button>
    </div>
  );
}
