import { useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { ContactoForm } from "../components/empresas/ContactoForm";
import { EmpresaForm } from "../components/empresas/EmpresaForm";
import { TAMANOS } from "../components/empresas/campos";
import { CotizacionesTab } from "../components/ficha/CotizacionesTab";
import { DocumentosTab } from "../components/ficha/DocumentosTab";
import { HistorialTab } from "../components/ficha/HistorialTab";
import { OportunidadesTab } from "../components/ficha/OportunidadesTab";
import { Button } from "../components/ui/Button";
import { Card, SectionTitle } from "../components/ui/Card";
import { EnlaceExterno, RedesContacto } from "../components/ui/Enlaces";
import { ServerError } from "../components/ui/Field";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import type { ContactoConMedio, EmpresaDetalle } from "../types";
import { ETIQUETA_MEDIO, claseMedio } from "../lib/medios";

const TABS = [
  { id: "info", label: "Información y contactos" },
  { id: "historial", label: "Historial" },
  { id: "oportunidades", label: "Oportunidades" },
  { id: "cotizaciones", label: "Cotizaciones" },
  { id: "documentos", label: "Documentos" }
] as const;
type TabId = (typeof TABS)[number]["id"];

// Agrupa las filas de GET /empresas/:id (una por medio de contacto) en un
// contacto con su arreglo de medios -- ver el comentario en types.ts sobre
// por qué esta respuesta no viene ya anidada como la de /contactos.
function agruparContactos(filas: ContactoConMedio[]) {
  const porId = new Map<number, { contacto: ContactoConMedio; medios: ContactoConMedio[] }>();
  for (const fila of filas) {
    const entry = porId.get(fila.id) ?? { contacto: fila, medios: [] };
    if (fila.medio_tipo) entry.medios.push(fila);
    porId.set(fila.id, entry);
  }
  return [...porId.values()];
}

export function FichaClientePage() {
  const { id } = useParams<{ id: string }>();
  // ?tab= abre una pestaña directo (las listas generales de Cotizaciones y
  // Documentos ligan a la pestaña de su empresa).
  const [params, setParams] = useSearchParams();
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "info";
  const setTab = (nuevo: TabId) => setParams(nuevo === "info" ? {} : { tab: nuevo }, { replace: true });

  const { data: empresa, isPending, isError } = useQuery({
    queryKey: ["empresa", id],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${id}`),
    enabled: Boolean(id)
  });

  const { user } = useAuth();
  // DELETE /empresas/:id es solo administrador/supervisor; editar y
  // gestionar contactos lo puede hacer también el agente dueño.
  const puedeDesactivar = user?.rol === "administrador" || user?.rol === "supervisor";
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editandoEmpresa, setEditandoEmpresa] = useState(false);
  const [agregandoContacto, setAgregandoContacto] = useState(false);
  const [editandoContactoId, setEditandoContactoId] = useState<number | null>(null);
  const [accionError, setAccionError] = useState<string | null>(null);

  async function desactivarEmpresa() {
    if (!empresa || !window.confirm(`¿Desactivar "${empresa.nombre_legal}"? Dejará de aparecer en el CRM junto con sus contactos, y sus medios ya no se usarán en campañas.`)) return;
    setAccionError(null);
    try {
      await api.delete(`/api/v1/empresas/${empresa.id}`);
      await queryClient.invalidateQueries({ queryKey: ["empresas"] });
      navigate("/empresas");
    } catch (error) {
      setAccionError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  async function desactivarContacto(contactoId: number, nombre: string) {
    if (!empresa || !window.confirm(`¿Desactivar a "${nombre}"? Sus medios de contacto ya no se usarán.`)) return;
    setAccionError(null);
    try {
      await api.delete(`/api/v1/empresas/${empresa.id}/contactos/${contactoId}`);
      await queryClient.invalidateQueries({ queryKey: ["empresa", id] });
      await queryClient.invalidateQueries({ queryKey: ["contactos"] });
    } catch (error) {
      setAccionError(error instanceof ApiError ? error.message : "No se pudo conectar con el servidor");
    }
  }

  const contactos = useMemo(() => (empresa ? agruparContactos(empresa.contactos) : []), [empresa]);
  // Para los selects de "contacto" de los formularios: solo activos (el
  // backend rechaza una oportunidad con un contacto desactivado).
  const opcionesContacto = useMemo(() => contactos.filter(({ contacto }) => contacto.activo).map(({ contacto }) => ({ id: contacto.id, nombre: contacto.nombre })), [contactos]);

  return (
    <AppShell titulo="Ficha de cliente">
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se encontró la empresa (o no tienes acceso a ella).</div>}

      {empresa && (
        <div className="flex flex-col gap-5">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3 p-6">
              <div>
                <div className="text-lg font-bold">{empresa.nombre_legal}</div>
                {empresa.nombre_comercial && <div className="text-sm text-ink-2">{empresa.nombre_comercial}</div>}
                <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-3">
                  {empresa.giro && <span>{empresa.giro}</span>}
                  {empresa.tamano && <span>· {TAMANOS.find((t) => t.valor === empresa.tamano)?.etiqueta ?? empresa.tamano}</span>}
                  {(empresa.ciudad || empresa.estado || empresa.region) && <span>· {[empresa.ciudad, empresa.estado, empresa.region].filter(Boolean).join(", ")}</span>}
                </div>
              </div>
              {!editandoEmpresa && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setEditandoEmpresa(true)}>
                    Editar empresa
                  </Button>
                  {puedeDesactivar && (
                    <Button variant="peligro" onClick={() => void desactivarEmpresa()}>
                      Desactivar
                    </Button>
                  )}
                </div>
              )}
            </div>
            {editandoEmpresa && <EmpresaForm empresa={empresa} onDone={() => setEditandoEmpresa(false)} />}
          </Card>

          <ServerError message={accionError} />

          <div className="flex gap-1 overflow-x-auto border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`shrink-0 whitespace-nowrap px-4 py-2.5 text-[13px] font-semibold ${tab === t.id ? "border-b-2 border-navy text-navy" : "text-ink-3"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "info" && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.1fr_1fr]">
              <Card className="p-6">
                <SectionTitle>Información de la empresa</SectionTitle>
                <dl className="grid grid-cols-[110px_1fr] gap-y-2.5 sm:grid-cols-[140px_1fr] text-[13px]">
                  <Campo etiqueta="País">{empresa.pais}</Campo>
                  <Campo etiqueta="Sitio web" enlace>{empresa.sitio_web}</Campo>
                  <Campo etiqueta="LinkedIn" enlace>{empresa.linkedin_url}</Campo>
                  <Campo etiqueta="Facebook" enlace>{empresa.facebook_url}</Campo>
                  <Campo etiqueta="Instagram" enlace>{empresa.instagram_url}</Campo>
                </dl>
              </Card>

              <Card className="p-6">
                <div className="flex items-start justify-between">
                  <SectionTitle>Contactos ({contactos.length})</SectionTitle>
                  {!agregandoContacto && (
                    <Button
                      variant="outline"
                      className="px-3 py-1.5 text-xs"
                      onClick={() => {
                        setAgregandoContacto(true);
                        setEditandoContactoId(null);
                      }}
                    >
                      + Agregar contacto
                    </Button>
                  )}
                </div>
                <div className="flex flex-col gap-4">
                  {agregandoContacto && <ContactoForm empresaId={empresa.id} onDone={() => setAgregandoContacto(false)} />}
                  {contactos.map((agrupado) => {
                    const { contacto, medios } = agrupado;
                    if (editandoContactoId === contacto.id) {
                      return <ContactoForm key={contacto.id} empresaId={empresa.id} contacto={agrupado} onDone={() => setEditandoContactoId(null)} />;
                    }
                    return (
                    <div key={contacto.id} className="rounded-[10px] border border-border p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-[13px] font-bold">{contacto.nombre}</div>
                          {(contacto.puesto || contacto.area) && <div className="text-xs text-ink-3">{[contacto.puesto, contacto.area].filter(Boolean).join(" · ")}</div>}
                        </div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            className="rounded-[7px] px-2 py-1 text-xs font-semibold text-navy hover:bg-bg"
                            onClick={() => {
                              setEditandoContactoId(contacto.id);
                              setAgregandoContacto(false);
                            }}
                          >
                            Editar
                          </button>
                          <button type="button" className="rounded-[7px] px-2 py-1 text-xs font-semibold text-danger hover:bg-bg" onClick={() => void desactivarContacto(contacto.id, contacto.nombre)}>
                            Desactivar
                          </button>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {medios.map((m) => (
                          <span
                            key={m.medio_id}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${claseMedio(m.estado_contacto)}`}
                            title={m.medio_valor ?? undefined}
                          >
                            {ETIQUETA_MEDIO[m.medio_tipo ?? ""] ?? m.medio_tipo}: {m.medio_valor}
                          </span>
                        ))}
                      </div>
                      <RedesContacto className="mt-2" linkedin={contacto.linkedin_url} facebook={contacto.facebook_url} instagram={contacto.instagram_url} />
                    </div>
                    );
                  })}
                  {contactos.length === 0 && <div className="text-sm text-ink-3">Sin contactos registrados.</div>}
                </div>
              </Card>
            </div>
          )}

          {tab === "historial" && <HistorialTab empresaId={empresa.id} contactos={opcionesContacto} />}
          {tab === "oportunidades" && <OportunidadesTab empresaId={empresa.id} contactos={opcionesContacto} />}

          {tab === "cotizaciones" && <CotizacionesTab empresaId={empresa.id} contactos={opcionesContacto} />}
          {tab === "documentos" && <DocumentosTab empresaId={empresa.id} contactos={opcionesContacto} />}
        </div>
      )}
    </AppShell>
  );
}

function Campo({ etiqueta, enlace = false, children }: { etiqueta: string; enlace?: boolean; children: string | null }) {
  return (
    <>
      <dt className="font-semibold text-ink-2">{etiqueta}</dt>
      <dd className="min-w-0 text-ink">{children ? enlace ? <EnlaceExterno url={children} /> : children : <span className="text-ink-3">—</span>}</dd>
    </>
  );
}
