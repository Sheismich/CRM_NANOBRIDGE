import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../components/layout/AppShell";
import { EstadoSistema } from "../components/admin/EstadoSistema";
import { ProblemasAbiertos } from "../components/admin/ProblemasAbiertos";
import { RegistroCambios, type FiltrosRegistro } from "../components/admin/RegistroCambios";
import { EquipoRoles } from "../components/admin/EquipoRoles";
import { IntegracionAdmin } from "../components/admin/IntegracionAdmin";
import { UsuariosAdmin } from "../components/admin/UsuariosAdmin";
import { Button } from "../components/ui/Button";
import { EncabezadoPagina } from "../components/ui/EncabezadoPagina";
import { Icono } from "../components/ui/Icono";
import { PanelLateral } from "../components/ui/PanelLateral";
import { Pastilla } from "../components/ui/Pastilla";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";

// Administración del rediseño (docs/diseno/administracion.html, ajustes del
// 11-oct): centro de control. Todo lo de /admin (estado del sistema,
// problemas agrupados, registro de cambios y su exportación) es solo del
// administrador; el supervisor ve "Equipo y roles" sin editar. La pestaña
// Auditoría cruda desapareció: la reemplaza el Registro de cambios.
// ?tab=integracion abre el detalle técnico de avisos y procesos fallidos
// ("Ver los N" de un problema).
export function AdministracionPage() {
  const { user } = useAuth();
  const esAdmin = user?.rol === "administrador";
  const [params, setParams] = useSearchParams();
  const [usuariosAbierto, setUsuariosAbierto] = useState(false);
  const [filtros, setFiltros] = useState<FiltrosRegistro>({ tipo: "todo", q: "" });
  const [exportando, setExportando] = useState<"pdf" | "csv" | null>(null);
  const [errorExport, setErrorExport] = useState<string | null>(null);

  async function exportar(formato: "pdf" | "csv") {
    setExportando(formato);
    setErrorExport(null);
    try {
      const qs = new URLSearchParams({ formato, tipo: filtros.tipo, ...(filtros.q ? { q: filtros.q } : {}) });
      await api.descargar(`/api/v1/admin/registro-cambios/export?${qs.toString()}`);
    } catch (err) {
      setErrorExport(err instanceof ApiError ? err.message : "No se pudo exportar");
    } finally {
      setExportando(null);
    }
  }

  if (esAdmin && params.get("tab") === "integracion") {
    return (
      <AppShell
        titulo="Administración"
        encabezado={
          <EncabezadoPagina
            ceja={
              <button type="button" onClick={() => setParams({}, { replace: true })} className="inline-flex items-center gap-1.5 font-bold text-navy hover:underline">
                <Icono nombre="flechaIzquierda" size={14} /> Administración
              </button>
            }
            titulo="Avisos y procesos fallidos"
            subtitulo="El detalle técnico de cada aviso hacia n8n y de cada falla que reportó el Error Workflow."
          />
        }
      >
        <IntegracionAdmin />
      </AppShell>
    );
  }

  return (
    <AppShell
      titulo="Administración"
      encabezado={
        <EncabezadoPagina
          ceja={
            <>
              <Pastilla tono="ok" punto mayusculas>
                Estado y control del sistema
              </Pastilla>
              <span className="inline-flex items-center gap-1 font-bold text-ok">
                <Icono nombre="escudo" size={14} /> En línea y auditado
              </span>
            </>
          }
          titulo="Administración"
          subtitulo={esAdmin ? "Si todo está funcionando, qué falla, quién movió qué y quién tiene acceso." : "Quién tiene acceso y qué puede hacer."}
          acciones={
            esAdmin && (
              <>
                <span className="hidden font-heading text-[11px] font-extrabold uppercase tracking-[2px] text-ink-3 md:inline">Exportar registro de cambios</span>
                <Button disabled={exportando !== null} onClick={() => void exportar("pdf")}>
                  <Icono nombre="descargar" size={16} /> {exportando === "pdf" ? "…" : "PDF"}
                </Button>
                <Button variant="outline" disabled={exportando !== null} onClick={() => void exportar("csv")}>
                  <Icono nombre="descargar" size={16} /> {exportando === "csv" ? "…" : "CSV"}
                </Button>
              </>
            )
          }
        />
      }
    >
      {errorExport && <p className="mb-3 rounded-[12px] bg-danger-bg px-4 py-2.5 text-[13px] text-danger">{errorExport}</p>}
      {esAdmin && <EstadoSistema />}
      <div className={esAdmin ? "mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,1fr)]" : "max-w-[640px]"}>
        {esAdmin && (
          <div className="flex min-w-0 flex-col gap-4">
            <ProblemasAbiertos onVerDetalle={() => setParams({ tab: "integracion" }, { replace: true })} />
            <RegistroCambios filtros={filtros} onFiltros={setFiltros} />
          </div>
        )}
        <EquipoRoles puedeEditar={esAdmin} onAdministrar={() => setUsuariosAbierto(true)} />
      </div>

      <PanelLateral abierto={usuariosAbierto} onCerrar={() => setUsuariosAbierto(false)} titulo={esAdmin ? "Administrar usuarios" : "Usuarios"} ancho={760} cuerpoClassName="!p-3 md:!p-4">
        {user && <UsuariosAdmin esAdmin={esAdmin} usuarioActualId={user.id} />}
      </PanelLateral>
    </AppShell>
  );
}
