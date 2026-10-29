import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button } from "../ui/Button";
import { ServerError } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Modal } from "../ui/Modal";
import { ApiError, api } from "../../lib/api";
import type { Empresa, EmpresaFicha } from "../../types";
import { BuscadorEmpresa } from "./BuscadorEmpresa";

// Control G-05 (29-oct-2026): fusionar esta empresa (la repetida) en otra, la
// que se queda. Solo administrador (POST /empresas/:id/fusionar). Primero se
// elige la destino -- arriba, las que se llaman igual --, luego se ve lo que
// se movería (simular=true) y hasta entonces se fusiona de verdad.

type Resumen = {
  origen: { id: number; nombre: string };
  destino: { id: number; nombre: string };
  mover: Record<string, number>;
  completar: string[];
  fusionada: boolean;
};

const QUE_SE_MUEVE: [string, string, string][] = [
  ["contactos", "contacto", "contactos"],
  ["prospectos", "prospecto", "prospectos"],
  ["oportunidades", "oportunidad", "oportunidades"],
  ["cotizaciones", "cotización", "cotizaciones"],
  ["documentos", "documento", "documentos"],
  ["actividades", "actividad del historial", "actividades del historial"],
  ["tareas", "tarea", "tareas"],
  ["medios_de_empresa", "medio de la empresa", "medios de la empresa"]
];

export function FusionarEmpresa({ empresa, abierto, onCerrar }: { empresa: EmpresaFicha; abierto: boolean; onCerrar: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const { data: parecidas } = useQuery({
    queryKey: ["empresas", "parecidas", empresa.nombre_legal, empresa.id],
    queryFn: () => api.get<{ data: Empresa[] }>("/api/v1/empresas/parecidas", { nombre: empresa.nombre_legal, excluir: empresa.id }),
    enabled: abierto
  });

  function cerrar() {
    setResumen(null);
    setError(null);
    onCerrar();
  }

  async function fusionar(destinoId: number, simular: boolean) {
    setError(null);
    if (destinoId === empresa.id) {
      setError("Elige otra empresa: esta es la que se va a fusionar.");
      return;
    }
    setOcupado(true);
    try {
      const res = await api.post<Resumen>(`/api/v1/empresas/${empresa.id}/fusionar`, { destinoId, simular });
      if (simular) {
        setResumen(res);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["empresas"] });
      await queryClient.invalidateQueries({ queryKey: ["empresa"] });
      cerrar();
      navigate(`/empresas/${destinoId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  const movimientos = resumen ? QUE_SE_MUEVE.filter(([clave]) => (resumen.mover[clave] ?? 0) > 0).map(([clave, uno, varios]) => `${resumen.mover[clave]} ${resumen.mover[clave] === 1 ? uno : varios}`) : [];

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      ancho={560}
      titulo={resumen ? `¿Fusionar en «${resumen.destino.nombre}»?` : "Fusionar con otra empresa"}
      descripcion={
        resumen
          ? `Todo lo de «${resumen.origen.nombre}» pasa a «${resumen.destino.nombre}», y «${resumen.origen.nombre}» queda desactivada. No se puede deshacer desde el CRM.`
          : `Si «${empresa.nombre_legal}» está repetida, elige la empresa que se queda. Sus contactos, prospectos, oportunidades e historial pasan a esa.`
      }
      acciones={
        resumen ? (
          <>
            <Button variant="ghost" disabled={ocupado} onClick={() => setResumen(null)}>
              Elegir otra
            </Button>
            <Button variant="rechazar" disabled={ocupado} onClick={() => void fusionar(resumen.destino.id, false)}>
              Sí, fusionar
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={cerrar}>
            Cancelar
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4 px-5 pb-2">
        <ServerError message={error} />
        {resumen ? (
          <div className="flex flex-col gap-3 text-[13px]">
            <div>
              <b className="text-strong">Se mueve:</b> {movimientos.length ? movimientos.join(", ") : "nada (la empresa está vacía)"}.
            </div>
            {resumen.completar.length > 0 && (
              <div>
                <b className="text-strong">«{resumen.destino.nombre}» toma de la otra:</b> {resumen.completar.join(", ")} (solo lo que le falta; lo que ya tiene no cambia).
              </div>
            )}
          </div>
        ) : (
          <>
            {(parecidas?.data.length ?? 0) > 0 && (
              <div>
                <div className="text-[13px] font-bold text-strong">Con el mismo nombre</div>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {parecidas!.data.map((e) => (
                    <li key={e.id}>
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => void fusionar(e.id, true)}
                        className="flex w-full items-center gap-2.5 rounded-[12px] border border-warn/40 bg-warn-bg px-3 py-2.5 text-left text-[13px] hover:border-warn"
                      >
                        <Icono nombre="empresa" size={16} className="shrink-0 text-warn" />
                        <span className="min-w-0 flex-1">
                          <b className="block truncate text-strong">{e.nombre_comercial ?? e.nombre_legal}</b>
                          {[e.giro, e.ciudad].filter(Boolean).length > 0 && <small className="text-[12px] text-ink-2">{[e.giro, e.ciudad].filter(Boolean).join(" · ")}</small>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <BuscadorEmpresa pregunta="¿En qué empresa se fusiona?" onElegir={(e) => void fusionar(e.id, true)} />
          </>
        )}
      </div>
    </Modal>
  );
}
