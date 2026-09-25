import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { HistorialTab } from "../components/ficha/HistorialTab";
import { OportunidadesTab } from "../components/ficha/OportunidadesTab";
import { Card, SectionTitle } from "../components/ui/Card";
import { api } from "../lib/api";
import type { ContactoConMedio, EmpresaDetalle } from "../types";

const TABS = [
  { id: "info", label: "Información y contactos" },
  { id: "historial", label: "Historial" },
  { id: "oportunidades", label: "Oportunidades" },
  { id: "cotizaciones", label: "Cotizaciones" },
  { id: "documentos", label: "Documentos" }
] as const;
type TabId = (typeof TABS)[number]["id"];

const ETIQUETA_MEDIO: Record<string, string> = {
  correo: "Correo",
  telefono: "Teléfono",
  whatsapp: "WhatsApp",
  linkedin: "LinkedIn",
  sitio_web: "Sitio web"
};

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
  const [tab, setTab] = useState<TabId>("info");

  const { data: empresa, isPending, isError } = useQuery({
    queryKey: ["empresa", id],
    queryFn: () => api.get<EmpresaDetalle>(`/api/v1/empresas/${id}`),
    enabled: Boolean(id)
  });

  const contactos = useMemo(() => (empresa ? agruparContactos(empresa.contactos) : []), [empresa]);

  return (
    <AppShell titulo="Ficha de cliente">
      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se encontró la empresa (o no tienes acceso a ella).</div>}

      {empresa && (
        <div className="flex flex-col gap-5">
          <Card className="p-6">
            <div className="text-lg font-bold">{empresa.nombre_legal}</div>
            {empresa.nombre_comercial && <div className="text-sm text-ink-2">{empresa.nombre_comercial}</div>}
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-ink-3">
              {empresa.giro && <span>{empresa.giro}</span>}
              {empresa.tamano && <span>· {empresa.tamano}</span>}
              {(empresa.ciudad || empresa.region) && <span>· {[empresa.ciudad, empresa.region].filter(Boolean).join(", ")}</span>}
            </div>
          </Card>

          <div className="flex gap-1 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`px-4 py-2.5 text-[13px] font-semibold ${tab === t.id ? "border-b-2 border-navy text-navy" : "text-ink-3"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "info" && (
            <div className="grid grid-cols-[1.1fr_1fr] gap-5">
              <Card className="p-6">
                <SectionTitle>Información de la empresa</SectionTitle>
                <dl className="grid grid-cols-[140px_1fr] gap-y-2.5 text-[13px]">
                  <Campo etiqueta="País">{empresa.pais}</Campo>
                  <Campo etiqueta="Sitio web">{empresa.sitio_web}</Campo>
                  <Campo etiqueta="LinkedIn">{empresa.linkedin_url}</Campo>
                  <Campo etiqueta="Facebook">{empresa.facebook_url}</Campo>
                  <Campo etiqueta="Instagram">{empresa.instagram_url}</Campo>
                </dl>
              </Card>

              <Card className="p-6">
                <SectionTitle>Contactos ({contactos.length})</SectionTitle>
                <div className="flex flex-col gap-4">
                  {contactos.map(({ contacto, medios }) => (
                    <div key={contacto.id} className="rounded-[10px] border border-border p-3.5">
                      <div className="text-[13px] font-bold">{contacto.nombre}</div>
                      {contacto.puesto && <div className="text-xs text-ink-3">{contacto.puesto}</div>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {medios.map((m) => (
                          <span
                            key={m.medio_id}
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                              m.estado_contacto === "no_contactar" ? "bg-danger-bg text-danger" : m.estado_contacto === "obsoleto" ? "bg-bg text-ink-3" : "bg-ok-bg text-ok"
                            }`}
                            title={m.medio_valor ?? undefined}
                          >
                            {ETIQUETA_MEDIO[m.medio_tipo ?? ""] ?? m.medio_tipo}: {m.medio_valor}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {contactos.length === 0 && <div className="text-sm text-ink-3">Sin contactos registrados.</div>}
                </div>
              </Card>
            </div>
          )}

          {tab === "historial" && <HistorialTab empresaId={empresa.id} />}
          {tab === "oportunidades" && <OportunidadesTab empresaId={empresa.id} />}

          {(tab === "cotizaciones" || tab === "documentos") && (
            <Card className="p-10 text-center text-sm text-ink-3">Esta pestaña todavía no está construida — llega en la siguiente fase (ver PLAN_FRONTEND.md §6).</Card>
          )}
        </div>
      )}
    </AppShell>
  );
}

function Campo({ etiqueta, children }: { etiqueta: string; children: string | null }) {
  return (
    <>
      <dt className="font-semibold text-ink-2">{etiqueta}</dt>
      <dd className="text-ink">{children ?? <span className="text-ink-3">—</span>}</dd>
    </>
  );
}
