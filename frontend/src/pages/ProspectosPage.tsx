import { Fragment, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/layout/AppShell";
import { CampanasTab } from "../components/prospectos/CampanasTab";
import { NuevoProspectoForm } from "../components/prospectos/NuevoProspectoForm";
import { Button } from "../components/ui/Button";
import { Card, SectionTitle } from "../components/ui/Card";
import { EstadoVacio } from "../components/ui/EstadoVacio";
import { ServerError, inputBaseClass, inputClass } from "../components/ui/Field";
import { ApiError, api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { campanasAsignables, useCampanas } from "../lib/campanas";
import { formatoFecha, formatoFechaHora } from "../lib/formato";
import { ETIQUETA_MEDIO, avisoMediosSuprimidos, claseMedio } from "../lib/medios";
import type { Borrador, EstadoBorrador, LoteImportacion, Paginated, ProspectoDetalle, ProspectoResumen } from "../types";

const TABS = [
  { id: "prospectos", label: "Prospectos" },
  { id: "importaciones", label: "Importaciones" },
  { id: "campanas", label: "Campañas" }
] as const;
type TabId = (typeof TABS)[number]["id"];

export function ProspectosPage() {
  const { user } = useAuth();
  // Abre en la lista; ?tab=campanas (liga del Inicio) o ?tab=importaciones
  // llevan directo a esas pestañas.
  const [searchParams] = useSearchParams();
  const tabInicial = TABS.find((t) => t.id === searchParams.get("tab"))?.id ?? "prospectos";
  const [tab, setTab] = useState<TabId>(tabInicial);
  // El alta manual vive en la pestaña Prospectos, pero también se lanza
  // desde Importaciones (ahí es donde se llega a capturar).
  const [creando, setCreando] = useState(false);
  return (
    <AppShell titulo="Prospectos">
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border">
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
      {tab === "importaciones" && (
        <Importaciones
          onNuevo={() => {
            setTab("prospectos");
            setCreando(true);
          }}
        />
      )}
      {tab === "prospectos" && <ListaProspectos creando={creando} setCreando={setCreando} onImportar={() => setTab("importaciones")} />}
      {tab === "campanas" && <CampanasTab puedeEditar={user?.rol === "administrador" || user?.rol === "supervisor"} />}
    </AppShell>
  );
}

// --- Importaciones ----------------------------------------------------------

// Mismos nombres de columna que filaCsvSchema (src/crm/dto/prospecto.schema.ts):
// el encabezado del CSV debe usarlos tal cual.
const COLUMNAS_CSV = [
  "empresaNombreLegal",
  "empresaGiro",
  "empresaTamano",
  "empresaRegion",
  "empresaEstado",
  "empresaCiudad",
  "empresaPais",
  "empresaSitioWeb",
  "contactoNombre",
  "contactoPuesto",
  "correo",
  "telefono",
  "canalInicial",
  "confianza",
  "prioridad",
  "score",
  "fuenteUrl",
  "observaciones",
  "campanaId"
];
const EJEMPLO_CSV = ["Aceros del Bajío S.A. de C.V.", "Manufactura metalmecánica", "mediana", "Bajío", "Guanajuato", "León", "MX", "https://acerosdelbajio.mx", "Ricardo Peña", "Gerente de Mantenimiento", "ventas@acerosbajio.mx", "+52 477 123 4567", "correo", "alta", "alta", "", "", "", ""];

function descargarPlantilla() {
  const csv = "﻿" + [COLUMNAS_CSV.join(","), EJEMPLO_CSV.map((v) => (v.includes(",") ? `"${v}"` : v)).join(",")].join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "plantilla_prospectos.csv";
  a.click();
  URL.revokeObjectURL(url);
}

const ETIQUETA_ESTADO: Record<EstadoBorrador, string> = {
  pendiente_revision: "Pendiente",
  duplicado: "Duplicada",
  importado: "Importada",
  rechazado: "Rechazada",
  expirado: "Expirada"
};
const CLASE_ESTADO: Record<EstadoBorrador, string> = {
  pendiente_revision: "bg-warn-bg text-warn",
  duplicado: "bg-warn-bg text-warn",
  importado: "bg-ok-bg text-ok",
  rechazado: "bg-danger-bg text-danger",
  expirado: "bg-bg text-ink-3"
};
const ETIQUETA_CANAL = { correo: "Correo", telefono: "Teléfono", whatsapp: "WhatsApp" } as const;

type Confirmacion = { id: number | null; medios_suprimidos?: string[] };

function Importaciones({ onNuevo }: { onNuevo: () => void }) {
  const queryClient = useQueryClient();
  const archivoInput = useRef<HTMLInputElement>(null);
  const [loteElegido, setLoteElegido] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstadoBorrador | "">("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // Campaña por default para las filas del CSV que no traigan campanaId.
  const [campanaId, setCampanaId] = useState("");
  const { data: campanas } = useCampanas();

  const { data: lotes, isPending: cargandoLotes } = useQuery({
    queryKey: ["lotes-importacion"],
    queryFn: () => api.get<{ data: LoteImportacion[] }>("/api/v1/prospectos/importaciones")
  });
  // Por default, el lote más reciente ("Última importación" del mockup).
  const loteId = loteElegido ?? lotes?.data[0]?.lote_id ?? null;
  const lote = lotes?.data.find((l) => l.lote_id === loteId);

  const { data: filas, isPending: cargandoFilas } = useQuery({
    queryKey: ["lote", loteId],
    queryFn: () => api.get<{ filas: Borrador[] }>(`/api/v1/prospectos/importaciones/${loteId}`),
    enabled: Boolean(loteId)
  });

  async function refrescar() {
    await Promise.all([queryClient.invalidateQueries({ queryKey: ["lotes-importacion"] }), queryClient.invalidateQueries({ queryKey: ["lote", loteId] }), queryClient.invalidateQueries({ queryKey: ["prospectos"] })]);
  }

  async function ejecutar(accion: () => Promise<void>) {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      await accion();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      // Un 409 al confirmar (CONTACTO_DESACTIVADO, PERSONA_YA_REGISTRADA,
      // IMPORTACION_VENCIDA…) suele significar que la fila cambió por fuera:
      // se recargan el lote y sus contadores. Con PERSONA_YA_REGISTRADA la
      // salida es volver a importar el archivo.
      if (err instanceof ApiError && err.status === 409) await refrescar();
    } finally {
      setOcupado(false);
    }
  }

  function importar(archivo: File | undefined) {
    if (!archivo) return;
    // Mismo tope que uploadCsvInterceptor en ProspectosController.
    if (archivo.size > 2 * 1024 * 1024) {
      setError("El CSV excede 2 MB");
      return;
    }
    void ejecutar(async () => {
      const form = new FormData();
      form.append("archivo", archivo);
      if (campanaId) form.append("campanaId", campanaId);
      const res = await api.postForm<{ lote_id: string; total: number; resumen: Partial<Record<EstadoBorrador, number>> }>("/api/v1/prospectos/importaciones", form);
      setLoteElegido(res.lote_id);
      setFiltro("");
      await refrescar();
      setAviso(`Se leyeron ${res.total} filas: ${res.resumen.pendiente_revision ?? 0} listas para confirmar, ${res.resumen.duplicado ?? 0} duplicadas y ${res.resumen.rechazado ?? 0} rechazadas. Nada se crea hasta que las confirmes.`);
    });
  }

  function confirmarFila(fila: Borrador, usarContactoExistente = false) {
    void ejecutar(async () => {
      const res = await api.post<Confirmacion>(`/api/v1/prospectos/importaciones/${loteId}/filas/${fila.id}/confirmar`, { usarContactoExistente });
      await refrescar();
      const aviso = avisoMediosSuprimidos(res.medios_suprimidos);
      if (aviso) setAviso(`Fila ${fila.fila_numero}: ${aviso}`);
    });
  }

  function rechazarFila(fila: Borrador) {
    void ejecutar(async () => {
      await api.post(`/api/v1/prospectos/importaciones/${loteId}/filas/${fila.id}/rechazar`);
      await refrescar();
    });
  }

  function confirmarTodas() {
    void ejecutar(async () => {
      const res = await api.post<{ total: number; confirmados: number; resultados: { ok: boolean; error?: string }[] }>(`/api/v1/prospectos/importaciones/${loteId}/confirmar-todos`);
      await refrescar();
      const fallidas = res.resultados.filter((r) => !r.ok);
      setAviso(`Se confirmaron ${res.confirmados} de ${res.total}.${fallidas.length ? ` ${fallidas.length} no se pudieron confirmar: ${fallidas[0]?.error}` : ""}`);
    });
  }

  const pendientes = lote?.resumen.pendiente_revision ?? 0;
  const filasVisibles = (filas?.filas ?? []).filter((f) => !filtro || f.estado === filtro);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <SectionTitle>{loteElegido ? "Importación" : "Última importación"}</SectionTitle>
          {lote && (
            <div className="-mt-2.5 text-xs text-ink-3">
              {lote.fuente} · subido el {formatoFechaHora.format(new Date(lote.creado_en))}
            </div>
          )}
          {lotes && lotes.data.length > 1 && (
            <select aria-label="Elegir importación" className={`${inputClass} mt-2 w-auto`} value={loteId ?? ""} onChange={(e) => setLoteElegido(e.target.value)}>
              {lotes.data.map((l) => (
                <option key={l.lote_id} value={l.lote_id}>
                  {l.fuente} — {formatoFecha.format(new Date(l.creado_en))}
                  {l.resumen.pendiente_revision + l.resumen.duplicado > 0 ? ` (${l.resumen.pendiente_revision + l.resumen.duplicado} por revisar)` : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={descargarPlantilla}>
            Descargar plantilla
          </Button>
          <Button variant="outline" onClick={onNuevo}>
            + Nuevo prospecto
          </Button>
          <select aria-label="Campaña del CSV" title="Campaña para las filas que no traigan campanaId" className={`${inputBaseClass} w-auto`} value={campanaId} onChange={(e) => setCampanaId(e.target.value)}>
            <option value="">Sin campaña</option>
            {campanasAsignables(campanas?.data).map((c) => (
              <option key={c.id} value={c.id}>
                Campaña: {c.nombre}
              </option>
            ))}
          </select>
          <Button disabled={ocupado} onClick={() => archivoInput.current?.click()}>
            + Importar CSV
          </Button>
          <input
            ref={archivoInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              importar(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <ServerError message={error} />
      {aviso && <div className="rounded-[9px] bg-ok-bg px-3.5 py-2.5 text-[13px] text-ok">{aviso}</div>}

      {cargandoLotes && <div className="text-sm text-ink-2">Cargando…</div>}
      {lotes && lotes.data.length === 0 && (
        <Card className="flex flex-col items-center gap-2 p-12 text-center">
          <div className="text-sm font-bold">Todavía no hay importaciones</div>
          <div className="max-w-lg text-[13px] text-ink-3">
            Sube un CSV con una fila por prospecto. Cada fila se valida y se busca como duplicada (por correo y después por teléfono); nada se crea hasta que la confirmes. Descarga la plantilla para ver las columnas.
          </div>
        </Card>
      )}

      {lote && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Contador etiqueta="Total en el lote" valor={lote.total} />
            <Contador etiqueta="Listas para confirmar" valor={lote.resumen.pendiente_revision} clase="text-ok" />
            <Contador etiqueta="Duplicadas" valor={lote.resumen.duplicado} clase="text-warn" />
            <Contador etiqueta="Rechazadas" valor={lote.resumen.rechazado} clase="text-danger" />
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
              <select aria-label="Filtrar por estado" className={`${inputBaseClass} w-auto`} value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoBorrador | "")}>
                <option value="">Estado: Todas</option>
                {Object.entries(ETIQUETA_ESTADO).map(([clave, etiqueta]) => (
                  <option key={clave} value={clave}>
                    {etiqueta}
                  </option>
                ))}
              </select>
              {pendientes > 0 && (
                <Button variant="exito" disabled={ocupado} onClick={confirmarTodas}>
                  Confirmar todas las pendientes ({pendientes})
                </Button>
              )}
            </div>

            {cargandoFilas && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
            {filas && (
              <div className="tabla-scroll"><table className="w-full border-collapse">
                <thead>
                  <tr className="bg-bg">
                    {["Fila", "Empresa", "Contacto", "Canal", "Prioridad", "Estado", "Acciones"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filasVisibles.map((f) => (
                    <tr key={f.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 text-[13px] text-ink-3">{f.fila_numero}</td>
                      <td className="px-4 py-3 text-[13px] font-semibold">{f.empresa_nombre_legal ?? "—"}</td>
                      <td className="px-4 py-3 text-[13px]">
                        {f.contacto_nombre ?? "—"}
                        <div className="text-xs text-ink-3">{[f.correo, f.telefono].filter(Boolean).join(" · ")}</div>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-ink-2">{f.canal_inicial ? ETIQUETA_CANAL[f.canal_inicial] : "—"}</td>
                      <td className="px-4 py-3 text-[13px] capitalize text-ink-2">{f.prioridad ?? "—"}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${CLASE_ESTADO[f.estado]}`}>{ETIQUETA_ESTADO[f.estado]}</span>
                      </td>
                      <td className="px-4 py-3">
                        <AccionesFila fila={f} ocupado={ocupado} onConfirmar={confirmarFila} onRechazar={rechazarFila} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {filas && <div className="border-t border-border px-5 py-3 text-xs text-ink-3">Mostrando {filasVisibles.length} de {filas.filas.length} filas</div>}
          </Card>
        </>
      )}
    </div>
  );
}

function Contador({ etiqueta, valor, clase = "text-ink" }: { etiqueta: string; valor: number; clase?: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-2">{etiqueta}</div>
      <div className={`mt-1 font-heading text-[26px] font-extrabold ${clase}`}>{valor}</div>
    </Card>
  );
}

// Qué se puede hacer con cada fila, según ProspectosService.confirmarFila():
// - pendiente: confirmar o rechazar.
// - duplicada contra un contacto que ya existe: confirmar reutilizándolo
//   (usarContactoExistente, nunca por accidente) o rechazar.
// - duplicada contra otra fila del mismo archivo: no se puede confirmar
//   hasta resolver la otra; solo rechazar.
// - rechazada/importada/expirada: nada.
function AccionesFila({ fila, ocupado, onConfirmar, onRechazar }: { fila: Borrador; ocupado: boolean; onConfirmar: (f: Borrador, usarExistente?: boolean) => void; onRechazar: (f: Borrador) => void }) {
  const motivo = fila.errores?.map((e) => e.mensaje).join("; ");
  if (fila.estado === "pendiente_revision") {
    return (
      <div className="flex gap-1.5">
        <Button variant="exito" disabled={ocupado} className="px-3 py-1.5" onClick={() => onConfirmar(fila)}>
          Confirmar
        </Button>
        <Button variant="ghost" disabled={ocupado} className="border border-border px-3 py-1.5" onClick={() => onRechazar(fila)}>
          Rechazar
        </Button>
      </div>
    );
  }
  if (fila.estado === "duplicado") {
    return (
      <div className="flex flex-col gap-1.5">
        {fila.match_contacto_id ? (
          <span className="text-xs text-ink-2">Ya existe un contacto con el mismo {fila.match_motivo === "telefono" ? "teléfono" : "correo"}.</span>
        ) : (
          <span className="text-xs text-ink-2">{motivo}</span>
        )}
        <div className="flex gap-1.5">
          {fila.match_contacto_id && (
            <Button disabled={ocupado} variant="outline" className="px-3 py-1.5" onClick={() => onConfirmar(fila, true)}>
              Usar contacto existente
            </Button>
          )}
          <Button variant="ghost" disabled={ocupado} className="border border-border px-3 py-1.5" onClick={() => onRechazar(fila)}>
            Rechazar
          </Button>
        </div>
      </div>
    );
  }
  if (fila.estado === "rechazado" && motivo) return <span className="text-xs text-ink-3">{motivo}</span>;
  return null;
}

// --- Prospectos ya confirmados -------------------------------------------------

const LIMIT = 25;
const COLUMNAS_PROSPECTOS = ["Empresa", "Contacto", "Estado", "Prioridad", "Score", "Alta"];

function ListaProspectos({ creando, setCreando, onImportar }: { creando: boolean; setCreando: (v: boolean) => void; onImportar: () => void }) {
  // Recién creado a mano: su detalle se muestra arriba de la lista, porque
  // puede no caer en la página que se está viendo.
  const [nuevoId, setNuevoId] = useState<number | null>(null);
  const [avisoNuevo, setAvisoNuevo] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [prioridad, setPrioridad] = useState("");
  const [page, setPage] = useState(1);
  const [abiertoId, setAbiertoId] = useState<number | null>(null);

  // Un agente solo ve prospectos de sus empresas (ProspectosService.listProspectos).
  const { data, isPending, isError } = useQuery({
    queryKey: ["prospectos", { busqueda, prioridad, page }],
    queryFn: () => api.get<Paginated<ProspectoResumen>>("/api/v1/prospectos", { q: busqueda || undefined, prioridad: prioridad || undefined, page, limit: LIMIT })
  });

  return (
    <Card className="overflow-hidden">
      <form
        className="flex flex-wrap gap-3 px-5 py-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setBusqueda(q.trim());
        }}
      >
        <input aria-label="Buscar" placeholder="Buscar por empresa o contacto…" className={`${inputBaseClass} w-72`} value={q} onChange={(e) => setQ(e.target.value)} />
        <select
          aria-label="Prioridad"
          className={`${inputBaseClass} w-auto`}
          value={prioridad}
          onChange={(e) => {
            setPage(1);
            setPrioridad(e.target.value);
          }}
        >
          <option value="">Prioridad: Todas</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        <Button type="submit" variant="outline">
          Buscar
        </Button>
        {!creando && (
          <Button
            type="button"
            className="ml-auto"
            onClick={() => {
              setNuevoId(null);
              setCreando(true);
            }}
          >
            + Nuevo prospecto
          </Button>
        )}
      </form>

      {creando && (
        <NuevoProspectoForm
          onDone={(id, aviso) => {
            setCreando(false);
            setNuevoId(id);
            setAvisoNuevo(aviso ?? null);
          }}
        />
      )}
      {nuevoId && (
        <div className="border-b border-border">
          <div className="bg-ok-bg px-5 py-2.5 text-[13px] text-ok">Prospecto creado.</div>
          {avisoNuevo && <div className="bg-warn-bg px-5 py-2.5 text-[13px] text-warn">{avisoNuevo}</div>}
          <ProspectoDetallePanel id={nuevoId} onClose={() => setNuevoId(null)} />
        </div>
      )}

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar los prospectos.</div>}
      {data && data.data.length === 0 && (busqueda || prioridad) && <div className="p-5 text-sm text-ink-3">No hay prospectos con ese filtro.</div>}
      {data && data.data.length === 0 && !busqueda && !prioridad && page === 1 && !creando && (
        <EstadoVacio
          className="p-5"
          titulo="Todavía no hay prospectos confirmados."
          texto="Importa un CSV y confirma sus filas, o da de alta uno a mano."
          accion={
            <Button type="button" variant="outline" onClick={onImportar}>
              Importar CSV
            </Button>
          }
        />
      )}

      {data && data.data.length > 0 && (
        <div className="tabla-scroll"><table className="w-full border-collapse">
          <thead>
            <tr className="bg-bg">
              {COLUMNAS_PROSPECTOS.map((h) => (
                <th key={h} className="px-5 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.data.map((p) => (
              <Fragment key={p.id}>
                <tr
                  className={`cursor-pointer border-t border-border hover:bg-bg ${abiertoId === p.id ? "bg-bg" : ""}`}
                  onClick={() => setAbiertoId(abiertoId === p.id ? null : p.id)}
                >
                  <td className="px-5 py-3 text-[13px] font-semibold">{p.empresa_nombre_legal}</td>
                  <td className="px-5 py-3 text-[13px]">{p.contacto_nombre}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{p.estado.replace(/_/g, " ")}</td>
                  <td className="px-5 py-3 text-[13px] capitalize text-ink-2">{p.prioridad ?? "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{p.score != null ? Number(p.score) : "—"}</td>
                  <td className="px-5 py-3 text-[13px] text-ink-2">{formatoFecha.format(new Date(p.creado_en))}</td>
                </tr>
                {abiertoId === p.id && (
                  <tr>
                    <td colSpan={COLUMNAS_PROSPECTOS.length} className="p-0">
                      <ProspectoDetallePanel id={p.id} onClose={() => setAbiertoId(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
      )}

      {data && (page > 1 || data.data.length === LIMIT) && (
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-xs text-ink-3">Página {page}</span>
          <Button variant="ghost" disabled={data.data.length < LIMIT} onClick={() => setPage((p) => p + 1)}>
            Siguiente
          </Button>
        </div>
      )}
    </Card>
  );
}

function ProspectoDetallePanel({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: p, isPending, isError } = useQuery({
    queryKey: ["prospecto", id],
    queryFn: () => api.get<ProspectoDetalle>(`/api/v1/prospectos/${id}`)
  });
  const { data: campanas } = useCampanas();
  const campana = campanas?.data.find((c) => c.id === p?.campana_id);

  return (
    <div className="border-t border-border bg-bg p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold">{p ? `${p.contacto.nombre} — ${p.empresa.nombre_legal}` : "Prospecto"}</div>
          {p?.contacto.puesto && <div className="text-xs text-ink-3">{p.contacto.puesto}</div>}
        </div>
        <div className="flex gap-2">
          {p && (
            <Link to={`/empresas/${p.empresa.id}`} className="rounded-[9px] border-[1.5px] border-navy bg-card px-4 py-2.5 text-[13px] font-bold text-navy">
              Ver ficha de la empresa
            </Link>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cerrar detalle
          </Button>
        </div>
      </div>

      {isPending && <div className="text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="text-sm text-danger">No se pudo cargar el prospecto.</div>}

      {p && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
            <Dato etiqueta="Estado">{p.estado.replace(/_/g, " ")}</Dato>
            <Dato etiqueta="Prioridad">{p.prioridad ?? "—"}</Dato>
            <Dato etiqueta="Confianza">{p.confianza ?? "—"}</Dato>
            <Dato etiqueta="Score">{p.score != null ? Number(p.score) : "—"}</Dato>
            <Dato etiqueta="Campaña">{p.campana_id != null ? (campana?.nombre ?? `#${p.campana_id}`) : "—"}</Dato>
            <Dato etiqueta="Fuente">
              {p.fuente_url ? (
                <a href={p.fuente_url} target="_blank" rel="noopener noreferrer" className="break-all text-navy hover:underline">
                  {p.fuente_url}
                </a>
              ) : (
                "—"
              )}
            </Dato>
            <Dato etiqueta="Alta">{formatoFechaHora.format(new Date(p.creado_en))}</Dato>
          </dl>
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-2">Medios de contacto</div>
            <div className="flex flex-wrap gap-1.5">
              {p.contacto.medios.map((m) => (
                <span
                  key={`${m.tipo}:${m.valor}`}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${claseMedio(m.estado_contacto)}`}
                >
                  {ETIQUETA_MEDIO[m.tipo] ?? m.tipo}: {m.valor}
                  {m.estado_contacto === "no_contactar" && " (no contactar)"}
                </span>
              ))}
              {p.contacto.medios.length === 0 && <span className="text-sm text-ink-3">Sin medios registrados.</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-3">{etiqueta}</dt>
      <dd>{children}</dd>
    </>
  );
}
