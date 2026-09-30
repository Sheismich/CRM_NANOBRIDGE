import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { RedesContacto } from "../components/ui/Enlaces";
import { inputBaseClass } from "../components/ui/Field";
import { Paginacion } from "../components/ui/Paginacion";
import { api } from "../lib/api";
import { ETIQUETA_MEDIO, claseMedio } from "../lib/medios";
import type { ContactoLista, Paginated } from "../types";

// Contactos (vista plana de GET /contactos, sin pasar por la empresa): para
// encontrar a una persona sin saber en qué empresa está. Un agente solo ve
// los contactos de sus empresas (lo filtra el backend). El alta y la edición
// de contactos se hacen en la ficha de su empresa, a donde lleva cada fila.

const LIMIT = 25;

export function ContactosPage() {
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [page, setPage] = useState(1);

  const { data, isPending, isError } = useQuery({
    queryKey: ["contactos", { busqueda, page }],
    queryFn: () => api.get<Paginated<ContactoLista>>("/api/v1/contactos", { q: busqueda || undefined, page, limit: LIMIT })
  });

  return (
    <AppShell titulo="Contactos">
      <Card className="overflow-hidden">
        <form
          className="flex flex-wrap gap-3 px-5 py-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setBusqueda(q.trim());
          }}
        >
          {/* GET /contactos?q= busca solo por el nombre de la persona. */}
          <input aria-label="Buscar" placeholder="Buscar por nombre del contacto…" className={`${inputBaseClass} w-72`} value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>

        {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
        {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar los contactos.</div>}
        {data && data.data.length === 0 && <div className="p-5 text-sm text-ink-3">No hay contactos{busqueda ? " con ese nombre" : ""}.</div>}
        {data && data.data.length > 0 && (
          <div className="tabla-scroll"><table className="w-full border-collapse">
            <thead>
              <tr className="bg-bg">
                {["Contacto", "Empresa", "Medios de contacto", "Redes"].map((h) => (
                  <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((c) => (
                <tr key={c.id} className="border-t border-border align-top">
                  <td className="px-5 py-3">
                    <div className="text-[13px] font-semibold">{c.nombre}</div>
                    {(c.puesto || c.area) && <div className="text-xs text-ink-3">{[c.puesto, c.area].filter(Boolean).join(" · ")}</div>}
                  </td>
                  <td className="px-5 py-3 text-[13px]">
                    <Link to={`/empresas/${c.empresa_id}`} className="hover:text-navy hover:underline">
                      {c.empresa_nombre}
                    </Link>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {c.medios.map((m) => (
                        <span key={m.id} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${claseMedio(m.estado_contacto)}`} title={m.estado_contacto === "no_contactar" ? "Pidió que no lo contacten por este medio" : undefined}>
                          {ETIQUETA_MEDIO[m.tipo] ?? m.tipo}: {m.valor}
                        </span>
                      ))}
                      {c.medios.length === 0 && <span className="text-xs text-ink-3">—</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-xs">
                    <RedesContacto linkedin={c.linkedin_url} facebook={c.facebook_url} instagram={c.instagram_url} />
                    {!c.linkedin_url && !c.facebook_url && !c.instagram_url && <span className="text-ink-3">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {data && <Paginacion page={page} limit={LIMIT} cantidad={data.data.length} onPage={setPage} />}
      </Card>
    </AppShell>
  );
}
