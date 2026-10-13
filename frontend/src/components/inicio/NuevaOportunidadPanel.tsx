import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PanelLateral } from "../ui/PanelLateral";
import { Icono } from "../ui/Icono";
import { inputClass } from "../ui/Field";
import { NuevaOportunidadForm } from "../ficha/NuevaOportunidadForm";
import { api } from "../../lib/api";
import type { Empresa, EmpresaDetalle, Paginated } from "../../types";

// "Crear nueva oportunidad" desde el Inicio. Una oportunidad cuelga de una
// empresa (y opcionalmente de uno de sus contactos), así que primero se
// busca la empresa (GET /empresas?q=) y luego va el mismo formulario de la
// ficha. Al crearla se abre su ficha en la pestaña Oportunidades.
export function NuevaOportunidadPanel({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  return (
    <PanelLateral abierto={abierto} onCerrar={onCerrar} titulo="Nueva oportunidad" cuerpoClassName="!p-0">
      <Contenido onCerrar={onCerrar} />
    </PanelLateral>
  );
}

function Contenido({ onCerrar }: { onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busqueda, setBusqueda] = useState("");
  const [elegida, setElegida] = useState<Empresa | null>(null);
  const q = busqueda.trim();

  const { data: empresas, isFetching } = useQuery({
    queryKey: ["empresas", "buscar", q],
    queryFn: () => api.get<Paginated<Empresa>>("/api/v1/empresas", { q: q || undefined, limit: 8, orden: "actividad" }),
    enabled: !elegida
  });
  const { data: detalle } = useQuery({
    queryKey: ["empresa", String(elegida?.id)],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${elegida!.id}`),
    enabled: Boolean(elegida)
  });
  // Una fila por medio en GET /empresas/:id: un contacto activo por id.
  const contactos = useMemo(
    () => [...new Map((detalle?.contactos ?? []).filter((c) => c.activo).map((c) => [c.id, c.nombre])).entries()].map(([id, nombre]) => ({ id, nombre })),
    [detalle]
  );

  if (elegida) {
    return (
      <div>
        <div className="flex items-center gap-2 px-4 py-3 text-[13px] md:px-5">
          <Icono nombre="empresa" size={16} className="text-ink-3" />
          <b className="min-w-0 flex-1 truncate text-strong">{elegida.nombre_comercial ?? elegida.nombre_legal}</b>
          <button type="button" onClick={() => setElegida(null)} className="text-[12px] font-bold text-navy hover:underline">
            Cambiar
          </button>
        </div>
        {detalle ? (
          <NuevaOportunidadForm
            empresaId={elegida.id}
            contactos={contactos}
            onDone={onCerrar}
            onCreada={() => {
              void queryClient.invalidateQueries({ queryKey: ["reportes"] });
              onCerrar();
              navigate(`/empresas/${elegida.id}?tab=oportunidades`);
            }}
          />
        ) : (
          <p className="px-5 text-[13px] text-ink-2">Cargando contactos…</p>
        )}
      </div>
    );
  }

  return (
    <div className="px-4 py-5 md:px-5">
      <label htmlFor="no-buscar" className="text-[13px] font-bold text-strong">
        ¿De qué empresa es?
      </label>
      <input
        id="no-buscar"
        data-autofocus
        placeholder="Busca por nombre…"
        className={`${inputClass} mt-2`}
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />
      <ul className="mt-3 flex flex-col gap-1.5">
        {(empresas?.data ?? []).map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => setElegida(e)}
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
