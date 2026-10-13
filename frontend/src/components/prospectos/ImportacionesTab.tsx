import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { Contador, FilaContadores } from "../ui/Contador";
import { ServerError, inputBaseClass } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import { Tarjeta } from "../ui/Tarjeta";
import type { Tono } from "../ui/tonos";
import { ApiError, api } from "../../lib/api";
import { campanasAsignables, useCampanas } from "../../lib/campanas";
import { formatoFecha, formatoFechaHora } from "../../lib/formato";
import { avisoMediosSuprimidos } from "../../lib/medios";
import type { Borrador, EstadoBorrador, LoteImportacion } from "../../types";

// Importaciones de Prospectos (docs/diseno/prospectos.html, pestaña
// Importaciones): zona para soltar el CSV, lista de lotes con su barra de
// resultado y, abajo, las filas del lote elegido para confirmarlas o
// rechazarlas. Importar no manda correos: nada entra al CRM hasta confirmar.

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
  pendiente_revision: "Por revisar",
  duplicado: "Duplicada",
  importado: "Importada",
  rechazado: "Rechazada",
  expirado: "Expirada"
};
const TONO_ESTADO: Record<EstadoBorrador, Tono> = {
  pendiente_revision: "warn",
  duplicado: "navy",
  importado: "ok",
  rechazado: "danger",
  expirado: "neutro"
};
// Color de cada parte de la barra del lote (mismo orden que el diseño).
const ORDEN_BARRA: { estado: EstadoBorrador; color: string; plural: string }[] = [
  { estado: "importado", color: "bg-ok", plural: "importadas" },
  { estado: "pendiente_revision", color: "bg-warn", plural: "por revisar" },
  { estado: "duplicado", color: "bg-navy", plural: "duplicadas" },
  { estado: "rechazado", color: "bg-danger", plural: "rechazadas" },
  { estado: "expirado", color: "bg-ink-3", plural: "expiradas" }
];
const ETIQUETA_CANAL = { correo: "Correo", telefono: "Teléfono", whatsapp: "WhatsApp" } as const;

type Confirmacion = { id: number | null; medios_suprimidos?: string[] };

export function ImportacionesTab() {
  const queryClient = useQueryClient();
  const archivoInput = useRef<HTMLInputElement>(null);
  const [loteElegido, setLoteElegido] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<EstadoBorrador | "">("");
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  // Campaña por default para las filas del CSV que no traigan campanaId.
  const [campanaId, setCampanaId] = useState("");
  const { data: campanas } = useCampanas();

  const { data: lotes, isPending: cargandoLotes } = useQuery({
    queryKey: ["lotes-importacion"],
    queryFn: () => api.get<{ data: LoteImportacion[] }>("/api/v1/prospectos/importaciones")
  });
  // Por default, el lote más reciente.
  const loteId = loteElegido ?? lotes?.data[0]?.lote_id ?? null;
  const lote = lotes?.data.find((l) => l.lote_id === loteId);

  const { data: filas, isPending: cargandoFilas } = useQuery({
    queryKey: ["lote", loteId],
    queryFn: () => api.get<{ filas: Borrador[] }>(`/api/v1/prospectos/importaciones/${loteId}`),
    enabled: Boolean(loteId)
  });

  async function refrescar() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lotes-importacion"] }),
      queryClient.invalidateQueries({ queryKey: ["lote", loteId] }),
      queryClient.invalidateQueries({ queryKey: ["prospectos"] })
    ]);
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
    <div className="flex flex-col gap-[18px]">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setArrastrando(true);
        }}
        onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastrando(false);
          importar(e.dataTransfer.files?.[0]);
        }}
        className={clsx(
          "flex flex-wrap items-center gap-[22px] rounded-[20px] border-2 border-dashed bg-[linear-gradient(120deg,var(--info-bg),transparent_70%)] p-5 md:p-[30px]",
          arrastrando ? "border-info" : "border-info/40"
        )}
      >
        <span className="grid h-16 w-16 shrink-0 place-items-center rounded-[18px] border border-border bg-card text-info">
          <Icono nombre="subir" size={30} />
        </span>
        <div className="min-w-0 flex-[1_1_18rem]">
          <h3 className="font-heading text-[18px] font-extrabold text-strong">Arrastra aquí tu CSV</h3>
          <p className="mt-1 max-w-[520px] text-[13px] text-ink-2">
            Se valida cada fila: duplicados por correo o teléfono, datos faltantes y formato. Tú confirmas antes de que entre al CRM. Importar no manda correos.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select aria-label="Campaña del CSV" title="Campaña para las filas que no traigan campanaId" className={`${inputBaseClass} w-auto`} value={campanaId} onChange={(e) => setCampanaId(e.target.value)}>
              <option value="">Sin campaña</option>
              {campanasAsignables(campanas?.data).map((c) => (
                <option key={c.id} value={c.id}>
                  Campaña: {c.nombre}
                </option>
              ))}
            </select>
            <Button variant="ghost" className="border border-border" onClick={descargarPlantilla}>
              Descargar plantilla
            </Button>
          </div>
        </div>
        <Button disabled={ocupado} onClick={() => archivoInput.current?.click()} className="w-full md:ml-auto md:w-auto">
          Elegir archivo
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

      <ServerError message={error} />
      {aviso && <div className="rounded-[10px] bg-ok-bg px-3.5 py-2.5 text-[13px] text-ok">{aviso}</div>}

      {cargandoLotes && <div className="text-sm text-ink-2">Cargando…</div>}

      {lotes && lotes.data.length > 0 && (
        <Tarjeta titulo="Lotes" icono="documento" color="cyan" extra={`${lotes.data.length} ${lotes.data.length === 1 ? "lote" : "lotes"}`} cuerpoClassName="!p-0">
          <ul className="divide-y divide-border">
            {lotes.data.map((l) => (
              <li key={l.lote_id}>
                <FilaLote lote={l} elegido={l.lote_id === loteId} onElegir={() => setLoteElegido(l.lote_id)} />
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}

      {lote && (
        <>
          <FilaContadores>
            <Contador etiqueta="En el lote" valor={lote.total} tono="navy" />
            <Contador etiqueta="Por confirmar" valor={lote.resumen.pendiente_revision} tono="warn" />
            <Contador etiqueta="Duplicadas" valor={lote.resumen.duplicado} tono="navy" />
            <Contador etiqueta="Rechazadas" valor={lote.resumen.rechazado} tono="danger" />
          </FilaContadores>

          <Tarjeta
            titulo={`Filas · ${lote.fuente}`}
            icono="check"
            color="menta"
            extra={formatoFechaHora.format(new Date(lote.creado_en))}
            cuerpoClassName="!p-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 md:px-[22px]">
              <select aria-label="Filtrar por estado" className={`${inputBaseClass} w-auto`} value={filtro} onChange={(e) => setFiltro(e.target.value as EstadoBorrador | "")}>
                <option value="">Estado: Todas</option>
                {Object.entries(ETIQUETA_ESTADO).map(([clave, etiqueta]) => (
                  <option key={clave} value={clave}>
                    {etiqueta}
                  </option>
                ))}
              </select>
              {pendientes > 0 && (
                <Button variant="aprobar" disabled={ocupado} onClick={confirmarTodas}>
                  Confirmar todas las pendientes ({pendientes})
                </Button>
              )}
            </div>

            {cargandoFilas && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
            {filas && (
              <div className="tabla-scroll tabla-tarjetas">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-soft">
                      {["Fila", "Empresa", "Contacto", "Canal", "Prioridad", "Estado", "Acciones"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left font-heading text-[11px] font-extrabold uppercase tracking-[1px] text-ink-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filasVisibles.map((f) => (
                      <tr key={f.id} className="border-t border-border align-top">
                        <td data-label="Fila" className="mono px-4 py-3 text-[13px] text-ink-3">
                          {f.fila_numero}
                        </td>
                        <td data-label="Empresa" className="px-4 py-3 text-[13px] font-bold text-strong">
                          {f.empresa_nombre_legal ?? "—"}
                        </td>
                        <td data-label="Contacto" className="px-4 py-3 text-[13px]">
                          {f.contacto_nombre ?? "—"}
                          <div className="text-xs text-ink-3">{[f.correo, f.telefono].filter(Boolean).join(" · ")}</div>
                        </td>
                        <td data-label="Canal" className="px-4 py-3 text-[13px] text-ink-2">
                          {f.canal_inicial ? ETIQUETA_CANAL[f.canal_inicial] : "—"}
                        </td>
                        <td data-label="Prioridad" className="px-4 py-3 text-[13px] capitalize text-ink-2">
                          {f.prioridad ?? "—"}
                        </td>
                        <td data-label="Estado" className="px-4 py-3">
                          <Pastilla tono={TONO_ESTADO[f.estado]} punto>
                            {ETIQUETA_ESTADO[f.estado]}
                          </Pastilla>
                        </td>
                        <td className="px-4 py-3">
                          <AccionesFila fila={f} ocupado={ocupado} onConfirmar={confirmarFila} onRechazar={rechazarFila} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {filas && (
              <div className="border-t border-border bg-soft px-4 py-3 text-xs text-ink-3 md:px-[22px]">
                Mostrando {filasVisibles.length} de {filas.filas.length} filas
              </div>
            )}
          </Tarjeta>
        </>
      )}

      {lotes && lotes.data.length === 0 && (
        <div className="text-center text-[13px] text-ink-3">Todavía no hay importaciones. Descarga la plantilla para ver las columnas que lleva el CSV.</div>
      )}
    </div>
  );
}

// Un lote en la lista: nombre del archivo, barra de resultado con su
// leyenda, fecha y lo que falta por hacer.
function FilaLote({ lote, elegido, onElegir }: { lote: LoteImportacion; elegido: boolean; onElegir: () => void }) {
  const porRevisar = lote.resumen.pendiente_revision + lote.resumen.duplicado;
  const partes = ORDEN_BARRA.map((p) => ({ ...p, n: lote.resumen[p.estado] ?? 0 })).filter((p) => p.n > 0);
  return (
    <button
      type="button"
      onClick={onElegir}
      aria-pressed={elegido}
      className={clsx("grid w-full grid-cols-1 items-center gap-3 px-4 py-4 text-left md:grid-cols-[minmax(0,1.6fr)_minmax(0,2fr)_120px_130px] md:gap-4 md:px-[22px]", elegido ? "bg-navy-bg" : "hover:bg-soft")}
    >
      <div className="min-w-0">
        <b className="block truncate text-[14px] text-strong">{lote.fuente}</b>
        <small className="block text-[12px] text-ink-3">{lote.total} filas</small>
      </div>
      <div className="min-w-0">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-soft">
          {partes.map((p) => (
            <i key={p.estado} className={clsx("block", p.color)} style={{ width: `${(p.n / Math.max(lote.total, 1)) * 100}%` }} />
          ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1 text-[11px] text-ink-2">
          {partes.map((p) => (
            <span key={p.estado} className="inline-flex items-center gap-1">
              <span className={clsx("h-2 w-2 rounded-[3px]", p.color)} />
              {p.n} {p.plural}
            </span>
          ))}
        </div>
      </div>
      <div>
        <b className="block text-[13px] text-strong">{formatoFecha.format(new Date(lote.creado_en))}</b>
        <small className="text-[12px] text-ink-3">{new Date(lote.creado_en).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</small>
      </div>
      <div className="md:justify-self-end">{porRevisar > 0 ? <Pastilla tono="warn">{porRevisar} por revisar</Pastilla> : <Pastilla tono="ok">Terminado</Pastilla>}</div>
    </button>
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
        <Button variant="aprobar" disabled={ocupado} className="px-3 py-1.5" onClick={() => onConfirmar(fila)}>
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
