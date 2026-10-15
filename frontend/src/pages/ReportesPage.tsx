import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { DiaReportes } from "../components/reportes/DiaReportes";
import { PanelReportes } from "../components/reportes/PanelReportes";
import { Button } from "../components/ui/Button";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { inputBaseClass } from "../components/ui/Field";
import { Icono } from "../components/ui/Icono";
import { Segmento } from "../components/ui/Segmento";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { isoDia } from "../lib/inicio";
import { nombreMesLargo, rangosDelPeriodo, type Periodo } from "../lib/reportes";
import type { Paginated, Usuario } from "../types";

// Reportes del rediseño (docs/diseno/reportes.html, opción A): cómo vamos
// en ventas, prospección y equipo. Día / Semana / Mes / Trimestre / Año
// arriba: "Día" es la bitácora (GET /reportes/dia) y los demás, el panel
// completo con el periodo hasta hoy contra el mismo tramo del anterior.
// Los reportes son de administrador y supervisor; un agente entra
// directo al Día, donde solo ve lo suyo (es la única ruta de reportes que
// el backend le abre). El periodo va en la URL (?periodo=dia).

const PERIODOS: { id: Periodo; texto: string }[] = [
  { id: "dia", texto: "Día" },
  { id: "semana", texto: "Semana" },
  { id: "mes", texto: "Mes" },
  { id: "trimestre", texto: "Trimestre" },
  { id: "anio", texto: "Año" }
];

export function ReportesPage() {
  const { user } = useAuth();
  const esAdmin = user?.rol === "administrador";
  const esAdminOSupervisor = esAdmin || user?.rol === "supervisor";
  const [params, setParams] = useSearchParams();
  const pedido = PERIODOS.find((p) => p.id === params.get("periodo"))?.id ?? "mes";
  const periodo: Periodo = esAdminOSupervisor ? pedido : "dia";
  const [responsableId, setResponsableId] = useState("");
  const [fecha, setFecha] = useState(() => isoDia(new Date()));
  const [exportando, setExportando] = useState(false);
  const [errorExportar, setErrorExportar] = useState<string | null>(null);

  const rangos = useMemo(() => (periodo === "dia" ? null : rangosDelPeriodo(periodo, new Date())), [periodo]);
  const { data: usuarios } = useQuery({
    queryKey: ["usuarios", "activos"],
    queryFn: () => api.get<Paginated<Usuario>>("/api/v1/usuarios", { activo: true, limit: 100 }),
    enabled: esAdminOSupervisor,
    staleTime: 5 * 60_000
  });
  const personas = usuarios?.data.filter((u) => u.rol !== "sistema");
  const responsable = responsableId ? Number(responsableId) : undefined;

  function cambiarPeriodo(p: Periodo) {
    const siguientes = new URLSearchParams(params);
    if (p === "mes") siguientes.delete("periodo");
    else siguientes.set("periodo", p);
    setParams(siguientes, { replace: true });
  }

  // Día: la bitácora en CSV. Panel: el informe ejecutivo en PDF del mes
  // en que termina el periodo (de Fabián, GET /reportes/export/informe-ejecutivo).
  async function exportar() {
    setExportando(true);
    setErrorExportar(null);
    try {
      const qs = new URLSearchParams(
        periodo === "dia"
          ? { fecha, ...(responsable ? { usuarioId: String(responsable) } : {}) }
          : { formato: "pdf", mes: rangos!.actual.fechaFin.slice(0, 7), ...(responsable ? { responsableId: String(responsable) } : {}) }
      );
      await api.descargar(`/api/v1/reportes/export/${periodo === "dia" ? "dia" : "informe-ejecutivo"}?${qs.toString()}`);
    } catch (err) {
      setErrorExportar(err instanceof ApiError ? err.message : "No se pudo exportar");
    } finally {
      setExportando(false);
    }
  }

  return (
    <AppShell
      titulo="Reportes"
      encabezado={
        <EncabezadoPagina
          titulo="Reportes"
          subtitulo={esAdminOSupervisor ? "Cómo vamos: ventas, prospección y equipo." : "Lo que hiciste cada día, en orden de hora."}
          acciones={
            <>
              {esAdminOSupervisor && <Segmento etiqueta="Periodo" valor={periodo} onCambiar={cambiarPeriodo} opciones={PERIODOS} />}
              {esAdminOSupervisor && (
                <select aria-label={periodo === "dia" ? "Persona" : "Responsable"} className={`${inputBaseClass} h-10 w-auto max-w-[220px]`} value={responsableId} onChange={(e) => setResponsableId(e.target.value)}>
                  <option value="">{periodo === "dia" ? "Persona: Todas" : "Responsable: Todos"}</option>
                  {personas?.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre}
                    </option>
                  ))}
                </select>
              )}
              <Button
                disabled={exportando}
                onClick={() => void exportar()}
                title={errorExportar ?? (periodo === "dia" ? "La bitácora del día en CSV" : `Informe ejecutivo de ${nombreMesLargo(rangos!.actual.fechaFin.slice(0, 7))} en PDF`)}
              >
                <Icono nombre="descargar" size={15} /> {exportando ? "Exportando…" : errorExportar ? "Reintentar" : "Exportar"}
              </Button>
            </>
          }
        />
      }
    >
      {periodo === "dia" || !rangos ? (
        <DiaReportes fecha={fecha} onFecha={setFecha} usuarioId={responsable} esAdmin={esAdmin} esAdminOSupervisor={esAdminOSupervisor} />
      ) : (
        <PanelReportes {...rangos} responsableId={responsable} />
      )}
    </AppShell>
  );
}
