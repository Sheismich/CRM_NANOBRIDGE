import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { PanelLateral } from "../ui/PanelLateral";
import { BuscadorEmpresa, EmpresaElegida } from "../empresas/BuscadorEmpresa";
import { NuevaOportunidadForm } from "../ficha/NuevaOportunidadForm";
import { api } from "../../lib/api";
import type { Empresa, EmpresaDetalle } from "../../types";

// "Crear nueva oportunidad" desde el Inicio. Una oportunidad cuelga de una
// empresa (y opcionalmente de uno de sus contactos), así que primero se
// busca la empresa y luego va el mismo formulario de la ficha. Al crearla
// se abre su ficha en la pestaña Oportunidades.
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
  const [elegida, setElegida] = useState<Empresa | null>(null);
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

  if (!elegida) {
    return (
      <div className="px-4 py-5 md:px-5">
        <BuscadorEmpresa onElegir={setElegida} />
      </div>
    );
  }

  return (
    <div>
      <EmpresaElegida empresa={elegida} onCambiar={() => setElegida(null)} />
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
