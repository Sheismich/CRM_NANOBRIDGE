import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { PanelLateral } from "../ui/PanelLateral";
import { Button } from "../ui/Button";
import { Icono } from "../ui/Icono";
import { Pastilla } from "../ui/Pastilla";
import { VistaPrevia } from "./VistaPrevia";
import { ModalRechazo } from "./ModalRechazo";
import { ApiError, api } from "../../lib/api";
import { ETIQUETA_REVISION, TONO_REVISION, cuando, useCatalogosDocumentos, useExpediente } from "../../lib/documentos";
import { formatoTamano, plural } from "../../lib/formato";
import type { Documento, DocumentoBandeja, DocumentoDetalle, Paginated } from "../../types";

// Panel de un documento (docs/diseno/capturas/documentos-al-clic.png):
// arriba el estado, el nombre, de qué empresa es, y Rechazar / Aprobar
// (solo administrador y supervisor); luego Nueva versión y Descargar; en
// medio la vista previa; abajo el resumen del expediente de la empresa, que
// lleva a la ficha. Se abre con la fila de la bandeja (trae los nombres) y
// se refresca con GET /documentos/:id.

const TEXTO_ESTADO: Record<Documento["revision"], string> = { por_revisar: "Pendiente de aprobación", aprobado: "Aprobado", rechazado: "Rechazado" };

export function PanelDocumento({ fila, onCerrar, puedeRevisar }: { fila: DocumentoBandeja | null; onCerrar: () => void; puedeRevisar: boolean }) {
  return (
    <PanelLateral
      abierto={fila !== null}
      onCerrar={onCerrar}
      ancho={820}
      titulo={fila?.nombre_original}
      cuerpoClassName="!p-0 bg-[#4b5670] dark:bg-[#070b17]"
      encabezado={fila && <Encabezado key={fila.id} fila={fila} puedeRevisar={puedeRevisar} />}
    >
      {fila && <Cuerpo key={fila.id} fila={fila} />}
    </PanelLateral>
  );
}

function useDetalle(id: number) {
  return useQuery({
    queryKey: ["documentos", "detalle", id],
    queryFn: () => api.get<DocumentoDetalle>(`/api/v1/documentos/${id}`)
  });
}

function Encabezado({ fila, puedeRevisar }: { fila: DocumentoBandeja; puedeRevisar: boolean }) {
  const queryClient = useQueryClient();
  const { data: detalle } = useDetalle(fila.id);
  const d = { ...fila, ...detalle };
  const [rechazando, setRechazando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const archivo = useRef<HTMLInputElement>(null);
  const vigente = d.estado === "vigente";

  async function ejecutar(accion: () => Promise<unknown>) {
    setOcupado(true);
    setError(null);
    try {
      await accion();
      await queryClient.invalidateQueries({ queryKey: ["documentos"] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  function nuevaVersion(f: File | undefined) {
    if (!f) return;
    const form = new FormData();
    form.append("archivo", f);
    void ejecutar(() => api.postForm(`/api/v1/documentos/${d.id}/version`, form));
  }

  return (
    <div>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Pastilla tono={TONO_REVISION[d.revision]} punto mayusculas>
              {TEXTO_ESTADO[d.revision]}
            </Pastilla>
            <span className="text-[12px] text-ink-3">
              Versión {d.version} · {formatoTamano(d.tamano_bytes)}
              {!vigente && ` · ${d.estado === "obsoleto" ? "versión anterior" : "archivado"}`}
            </span>
          </div>
          <h2 className="mt-1.5 break-words font-heading text-[15px] font-extrabold text-strong md:text-[16px]">{d.nombre_original}</h2>
          <p className="text-[12.5px] text-ink-3">
            <Link to={`/empresas/${d.empresa_id}?tab=documentos`} className="font-bold text-navy hover:underline">
              {fila.empresa_nombre}
            </Link>
            {fila.tipo_nombre && ` · ${fila.tipo_nombre}`} · subido {cuando(d.creado_en, new Date()).toLowerCase()}
          </p>
        </div>
        {puedeRevisar && vigente && (
          <div className="flex gap-2">
            {d.revision !== "rechazado" && (
              <Button variant="rechazar" disabled={ocupado} onClick={() => setRechazando(true)}>
                <Icono nombre="xCirculo" size={17} /> Rechazar
              </Button>
            )}
            {d.revision !== "aprobado" && (
              <Button variant="aprobar" disabled={ocupado} onClick={() => void ejecutar(() => api.patch(`/api/v1/documentos/${d.id}/aprobar`))}>
                <Icono nombre="escudo" size={17} /> Aprobar documento
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {vigente && (
          <>
            <input ref={archivo} type="file" accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg" className="hidden" onChange={(e) => nuevaVersion(e.target.files?.[0])} />
            <Button variant="outline" disabled={ocupado} onClick={() => archivo.current?.click()}>
              Nueva versión
            </Button>
          </>
        )}
        <Button variant="outline" onClick={() => void ejecutar(() => api.descargar(`/api/v1/documentos/${d.id}/descarga`))}>
          <Icono nombre="descargar" size={16} /> Descargar
        </Button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-danger">{error}</p>}
      <ModalRechazo documento={rechazando ? { id: d.id, nombre: d.nombre_original, empresa: fila.empresa_nombre } : null} onCerrar={() => setRechazando(false)} />
    </div>
  );
}

function Cuerpo({ fila }: { fila: DocumentoBandeja }) {
  const { data: detalle } = useDetalle(fila.id);
  const d = { ...fila, ...detalle };
  const { data: catalogos } = useCatalogosDocumentos();
  const nombreMotivo = catalogos?.motivos_rechazo.find((m) => m.clave === d.motivo_rechazo)?.nombre ?? d.motivo_rechazo;

  return (
    <div className="flex flex-col gap-4 px-3 py-4 md:px-6 md:py-6">
      {d.revision === "rechazado" && (
        <div className="rounded-[14px] border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger">
          <b>Rechazado{nombreMotivo && `: ${nombreMotivo}`}.</b> {d.motivo_rechazo_detalle}
          {fila.revisado_por_nombre && d.revisado_en && (
            <span className="text-danger/80">
              {" "}
              — {fila.revisado_por_nombre}, {cuando(d.revisado_en, new Date()).toLowerCase()}
            </span>
          )}
        </div>
      )}
      <VistaPrevia key={d.id} documento={d} onDescargar={() => void api.descargar(`/api/v1/documentos/${d.id}/descarga`)} />
      {detalle && detalle.versiones.length > 1 && (
        <p className="text-center text-[12px] text-white/70">
          {plural(detalle.versiones.length, "versión", "versiones")}:{" "}
          {detalle.versiones.map((v) => `v${v.version}${v.id === d.id ? " (esta)" : ""}`).join(" · ")}
        </p>
      )}
      <ResumenExpediente empresaId={d.empresa_id} empresa={fila.empresa_nombre} actual={d.id} />
    </div>
  );
}

const CLASE_TARJETITA: Record<"falta" | Documento["revision"], string> = {
  por_revisar: "border-warn/30 bg-warn-bg text-warn",
  aprobado: "border-ok/30 bg-ok-bg text-ok",
  rechazado: "border-danger/30 bg-danger-bg text-danger",
  falta: "border-dashed border-border bg-soft text-ink-3"
};

// Resumen del expediente (punto 49). Mientras no haya papeles obligatorios
// (total 0, decisión de Carlos del 12-oct), enseña los documentos vigentes
// de la empresa con su estado. Cada tarjetita lleva a la ficha.
function ResumenExpediente({ empresaId, empresa, actual }: { empresaId: number; empresa: string; actual: number }) {
  const { data: expediente } = useExpediente(empresaId);
  const sinPapeles = expediente?.total === 0;
  const { data: docs } = useQuery({
    queryKey: ["documentos", "de-empresa", empresaId],
    queryFn: () => api.get<Paginated<DocumentoBandeja>>("/api/v1/documentos", { empresaId, estado: "vigente", limit: 6 }),
    enabled: sinPapeles
  });
  if (!expediente) return null;
  const liga = `/empresas/${empresaId}?tab=documentos`;
  const tarjetas = sinPapeles
    ? (docs?.data ?? []).slice(0, 5).map((x) => ({ clave: String(x.id), titulo: x.tipo_nombre ?? "Sin tipo", estado: x.revision as "falta" | Documento["revision"], pie: x.nombre_original, esta: x.id === actual }))
    : expediente.papeles.map((p, i) => ({ clave: String(p.tipo_id), titulo: `${i + 1}. ${p.nombre}`, estado: p.estado, pie: p.documento ? `v${p.documento.version} · ${p.documento.nombre_original}` : "aún no se sube", esta: p.documento?.id === actual }));

  return (
    <section className="rounded-[18px] bg-card px-4 py-4 shadow-[0_20px_40px_-20px_rgba(0,0,0,0.5)] md:px-5">
      <div className="flex flex-wrap items-start gap-3">
        <Icono nombre="carpeta" size={20} className="mt-0.5 text-navy" />
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-[15px] font-extrabold text-strong">Expediente de {empresa}</h3>
          <p className="text-[12px] text-ink-3">Toca un papel para abrir el expediente en la ficha de la empresa.</p>
        </div>
        <Pastilla tono={sinPapeles ? "navy" : expediente.completo ? "ok" : "warn"}>
          {sinPapeles ? plural(docs?.data.length ?? 0, "documento", "documentos") : `${expediente.aprobados} de ${expediente.total} aprobados`}
        </Pastilla>
      </div>
      {tarjetas.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
          {tarjetas.map((t) => (
            <Link key={t.clave} to={liga} className={clsx("min-w-0 rounded-[12px] border px-3 py-2.5 hover:brightness-95", CLASE_TARJETITA[t.estado], t.esta && "ring-2 ring-navy/50")}>
              <div className="truncate font-heading text-[10.5px] font-extrabold uppercase tracking-[1px]">{t.titulo}</div>
              <div className="mt-1 text-[13.5px] font-bold text-strong">{t.estado === "falta" ? "Falta" : ETIQUETA_REVISION[t.estado]}</div>
              <div className="truncate text-[11px] opacity-80">{t.pie}</div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-ink-2">Esta empresa todavía no tiene otros documentos.</p>
      )}
      <Link to={liga} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-bold text-info hover:underline">
        Ver expediente completo <Icono nombre="flechaDerecha" size={15} />
      </Link>
    </section>
  );
}
