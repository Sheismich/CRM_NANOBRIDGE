import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { Field, inputClass } from "../ui/Field";
import { EmpresaForm } from "../empresas/EmpresaForm";
import { CotizacionForm } from "../ficha/CotizacionForm";
import { NuevaOportunidadForm } from "../ficha/NuevaOportunidadForm";
import { useOportunidadesEmpresa } from "../ficha/queries";
import { api } from "../../lib/api";
import type { Empresa, EmpresaDetalle, Paginated } from "../../types";

// "Nueva cotización" desde la lista general (6-oct-2026): antes solo se
// podía cotizar desde la ficha de la empresa. Una cotización cuelga de una
// oportunidad ABIERTA de la empresa (el backend la exige), así que el flujo
// es empresa → oportunidad → partidas, con atajos para crear la empresa o
// la oportunidad sin salir de aquí. Reusa los mismos formularios que la ficha.
export function NuevaCotizacionPanel({ onCerrar, onGuardada }: { onCerrar: () => void; onGuardada: () => void }) {
  const [empresaId, setEmpresaId] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [creandoEmpresa, setCreandoEmpresa] = useState(false);
  const [creandoOportunidad, setCreandoOportunidad] = useState(false);
  const [oportunidadNueva, setOportunidadNueva] = useState<number | undefined>(undefined);

  // GET /empresas no tiene búsqueda: las primeras 100 y se filtran aquí
  // (igual que NuevaTareaForm). A un agente le llegan solo las suyas, las
  // únicas en las que puede cotizar.
  const { data: empresas } = useQuery({
    queryKey: ["empresas", "selector"],
    queryFn: () => api.get<Paginated<Empresa>>("/api/v1/empresas", { limit: 100 })
  });
  const { data: empresa } = useQuery({
    queryKey: ["empresa", empresaId],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${empresaId}`),
    enabled: Boolean(empresaId)
  });
  const opcionesEmpresa = useMemo(() => {
    const q = filtroEmpresa.trim().toLowerCase();
    const todas = empresas?.data ?? [];
    const filtradas = q ? todas.filter((e) => e.id === Number(empresaId) || `${e.nombre_legal} ${e.nombre_comercial ?? ""}`.toLowerCase().includes(q)) : todas;
    // La elegida siempre en la lista (p. ej. una recién creada que no cae
    // entre las primeras 100).
    return empresa && !filtradas.some((e) => e.id === empresa.id) ? [empresa, ...filtradas] : filtradas;
  }, [empresas, filtroEmpresa, empresaId, empresa]);

  const { data: oportunidades, isPending: cargandoOportunidades } = useOportunidadesEmpresa(Number(empresaId));
  const abiertas = useMemo(() => (oportunidades?.data ?? []).filter((o) => !o.cerrada), [oportunidades]);
  // Una fila por medio en GET /empresas/:id: un contacto activo por id.
  const contactos = useMemo(
    () => [...new Map((empresa?.contactos ?? []).filter((c) => c.activo).map((c) => [c.id, c.nombre])).entries()].map(([id, nombre]) => ({ id, nombre })),
    [empresa]
  );

  function elegirEmpresa(id: string) {
    setEmpresaId(id);
    setCreandoOportunidad(false);
    setOportunidadNueva(undefined);
  }

  return (
    <div className="flex flex-col border-b border-border">
      <div className="flex flex-col gap-4 bg-bg p-5">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold">Nueva cotización</div>
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
        </div>
        <Field label="Empresa" htmlFor="nc-empresa">
          <div className="flex flex-wrap gap-2">
            <input aria-label="Filtrar empresas" placeholder="Filtrar…" className={`${inputClass} max-w-40`} value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)} />
            <select id="nc-empresa" className={`${inputClass} min-w-0 flex-1`} value={empresaId} disabled={creandoEmpresa} onChange={(e) => elegirEmpresa(e.target.value)}>
              <option value="">— Elige —</option>
              {opcionesEmpresa.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nombre_legal}
                </option>
              ))}
            </select>
            {!creandoEmpresa && (
              <Button type="button" variant="outline" onClick={() => setCreandoEmpresa(true)}>
                + Crear empresa
              </Button>
            )}
          </div>
        </Field>
        {!empresaId && !creandoEmpresa && <div className="text-[13px] text-ink-2">Elige la empresa (o créala) y abajo aparecen sus oportunidades abiertas y las partidas.</div>}
      </div>

      {creandoEmpresa && (
        <EmpresaForm
          onDone={() => setCreandoEmpresa(false)}
          onCreada={(id) => {
            setCreandoEmpresa(false);
            elegirEmpresa(String(id));
          }}
        />
      )}

      {empresaId && !creandoEmpresa && (
        <>
          {cargandoOportunidades && <div className="px-5 pb-5 text-sm text-ink-2">Cargando oportunidades…</div>}
          {!cargandoOportunidades && !creandoOportunidad && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-bg px-5 pb-4 text-[13px] text-ink-2">
              <span>{abiertas.length === 0 ? "Se cotiza contra una oportunidad abierta, y esta empresa no tiene ninguna. Créala para continuar." : "La cotización va ligada a una oportunidad abierta de la empresa."}</span>
              <Button type="button" variant="outline" onClick={() => setCreandoOportunidad(true)}>
                + Crear oportunidad
              </Button>
            </div>
          )}
          {creandoOportunidad && (
            <NuevaOportunidadForm
              empresaId={Number(empresaId)}
              contactos={contactos}
              onDone={() => setCreandoOportunidad(false)}
              onCreada={(id) => {
                setCreandoOportunidad(false);
                setOportunidadNueva(id);
              }}
            />
          )}
          {!cargandoOportunidades && !creandoOportunidad && abiertas.length > 0 && (
            <CotizacionForm
              key={`${empresaId}-${oportunidadNueva ?? ""}`}
              modo="crear"
              empresaId={Number(empresaId)}
              contactos={contactos}
              oportunidades={abiertas}
              oportunidadId={oportunidadNueva}
              onDone={onCerrar}
              onGuardada={onGuardada}
            />
          )}
        </>
      )}
    </div>
  );
}
