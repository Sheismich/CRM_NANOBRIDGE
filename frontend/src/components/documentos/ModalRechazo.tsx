import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Icono } from "../ui/Icono";
import { ServerError } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { useCatalogosDocumentos } from "../../lib/documentos";

// "Rechazar documento" (docs/diseno/capturas/documentos-rechazo.png): motivo
// rápido del catálogo + explicación OBLIGATORIA de hasta 500 letras. Lo ve
// quien lo subió (tarea "Corregir documento") y el papel vuelve a faltar en
// el expediente.
const MAXIMO = 500;

export function ModalRechazo({ documento, onCerrar, onRechazado }: { documento: { id: number; nombre: string; empresa: string } | null; onCerrar: () => void; onRechazado?: () => void }) {
  return (
    <Modal
      abierto={documento !== null}
      onCerrar={onCerrar}
      ancho={560}
      titulo={
        <span className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-danger-bg text-danger">
            <Icono nombre="xCirculo" size={22} />
          </span>
          Rechazar documento
        </span>
      }
      descripcion={documento && `${documento.nombre} · ${documento.empresa}`}
    >
      {documento && <Formulario id={documento.id} onCerrar={onCerrar} onRechazado={onRechazado} />}
    </Modal>
  );
}

function Formulario({ id, onCerrar, onRechazado }: { id: number; onCerrar: () => void; onRechazado?: () => void }) {
  const queryClient = useQueryClient();
  const { data: catalogos } = useCatalogosDocumentos();
  const [motivo, setMotivo] = useState("");
  const [detalle, setDetalle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function rechazar() {
    if (!motivo) return setError("Elige por qué se rechaza.");
    if (detalle.trim().length < 2) return setError("Explica el motivo: quien lo subió necesita saber qué corregir.");
    setOcupado(true);
    setError(null);
    try {
      await api.patch(`/api/v1/documentos/${id}/rechazar`, { motivoRechazo: motivo, motivoRechazoDetalle: detalle.trim() });
      // También el Historial de la ficha (y su resumen con IA), que enseña los documentos.
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["documentos"] }), queryClient.invalidateQueries({ queryKey: ["timeline"] })]);
      onRechazado?.();
      onCerrar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[13px] font-bold text-strong">¿Por qué se rechaza?</div>
      <div className="flex flex-wrap gap-2">
        {(catalogos?.motivos_rechazo ?? []).map((m) => (
          <button
            key={m.clave}
            type="button"
            aria-pressed={motivo === m.clave}
            onClick={() => setMotivo(m.clave)}
            className={clsx(
              "rounded-full border px-3.5 py-1.5 text-[13px] font-semibold",
              motivo === m.clave ? "border-danger/40 bg-danger-bg font-bold text-danger" : "border-border bg-card text-strong hover:border-danger/30"
            )}
          >
            {m.nombre}
          </button>
        ))}
      </div>
      <label htmlFor="rechazo-detalle" className="mt-1 flex items-center gap-2 text-[13px] font-bold text-strong">
        Explica el motivo
        <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[10px] font-extrabold tracking-[1px] text-danger">OBLIGATORIO</span>
      </label>
      <textarea
        id="rechazo-detalle"
        data-autofocus
        rows={3}
        maxLength={MAXIMO}
        value={detalle}
        onChange={(e) => setDetalle(e.target.value)}
        placeholder="Ej. El sello de la notaría en la página 1 no se lee. Pide al cliente una copia escaneada a color."
        className="w-full rounded-[12px] border-[1.5px] border-danger/40 bg-card px-3.5 py-3 text-[14px] text-ink outline-none focus:border-danger"
      />
      <div className="-mt-1.5 text-right text-[11.5px] text-ink-3">
        {detalle.length} / {MAXIMO}
      </div>
      <div className="flex gap-2 rounded-[12px] bg-info-bg px-3.5 py-3 text-[12.5px] text-ink-2">
        <Icono nombre="info" size={16} className="mt-px shrink-0 text-info" />
        El motivo queda en el historial del documento y lo verá quien lo subió. El papel vuelve a contar como faltante en el expediente.
      </div>
      <ServerError message={error} />
      <div className="flex justify-end gap-2.5 pt-1">
        <Button variant="outline" onClick={onCerrar}>
          Cancelar
        </Button>
        <Button disabled={ocupado} onClick={() => void rechazar()} className="!bg-[linear-gradient(120deg,#d63a4a,#b23a45)] shadow-[0_10px_22px_-12px_rgba(214,58,74,0.8)]">
          {ocupado ? "Rechazando…" : "Rechazar documento"}
        </Button>
      </div>
    </div>
  );
}
