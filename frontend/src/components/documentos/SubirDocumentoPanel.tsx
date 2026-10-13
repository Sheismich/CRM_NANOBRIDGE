import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PanelLateral } from "../ui/PanelLateral";
import { BuscadorEmpresa, EmpresaElegida } from "../empresas/BuscadorEmpresa";
import { SubirDocumentoForm } from "../ficha/DocumentosTab";
import { useOportunidadesEmpresa } from "../ficha/queries";
import { api } from "../../lib/api";
import { useCatalogosDocumentos } from "../../lib/documentos";
import type { Empresa, EmpresaDetalle } from "../../types";

// "Subir documento" desde la bandeja: todo documento cuelga de una
// empresa, así que primero se elige la empresa y luego va el mismo
// formulario de la ficha (tipo, oportunidad y contacto opcionales).
export function SubirDocumentoPanel({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  return (
    <PanelLateral abierto={abierto} onCerrar={onCerrar} titulo="Subir documento" cuerpoClassName="!p-0">
      <Contenido onCerrar={onCerrar} />
    </PanelLateral>
  );
}

function Contenido({ onCerrar }: { onCerrar: () => void }) {
  const [empresa, setEmpresa] = useState<Empresa | null>(null);
  const { data: catalogos } = useCatalogosDocumentos();
  const { data: detalle } = useQuery({
    queryKey: ["empresa", String(empresa?.id)],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${empresa!.id}`),
    enabled: Boolean(empresa)
  });
  const { data: oportunidades } = useOportunidadesEmpresa(empresa?.id ?? 0);
  // Una fila por medio en GET /empresas/:id: un contacto activo por id.
  const contactos = useMemo(
    () => [...new Map((detalle?.contactos ?? []).filter((c) => c.activo).map((c) => [c.id, c.nombre])).entries()].map(([id, nombre]) => ({ id, nombre })),
    [detalle]
  );

  if (!empresa) {
    return (
      <div className="px-4 py-5 md:px-5">
        <BuscadorEmpresa pregunta="¿De qué empresa es el documento?" onElegir={setEmpresa} />
      </div>
    );
  }
  return (
    <div>
      <EmpresaElegida empresa={empresa} onCambiar={() => setEmpresa(null)} />
      <SubirDocumentoForm empresaId={empresa.id} tipos={catalogos?.tipos_documento ?? []} oportunidades={oportunidades?.data ?? []} contactos={contactos} onDone={onCerrar} />
    </div>
  );
}
