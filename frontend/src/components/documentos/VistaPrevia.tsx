import { useEffect, useState, type ReactNode } from "react";
import { Icono } from "../ui/Icono";
import { ApiError, api } from "../../lib/api";
import { tieneVistaPrevia } from "../../lib/documentos";
import type { Documento } from "../../types";

// Vista previa del documento dentro del panel. Se pide el archivo con la
// sesión (?modo=ver, que el backend solo da para PDF e imágenes), se arma
// un URL blob: y se muestra: PDF en <iframe> (visor del navegador), imagen
// en <img>. DOCX y XLSX no tienen vista previa: se descargan.
type Estado = { tipo: "cargando" } | { tipo: "listo"; url: string } | { tipo: "error"; mensaje: string };

export function VistaPrevia({ documento, onDescargar }: { documento: Pick<Documento, "id" | "mime_type" | "nombre_original">; onDescargar: () => void }) {
  const se = tieneVistaPrevia(documento.mime_type);
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });

  useEffect(() => {
    if (!se) return;
    const control = new AbortController();
    let url: string | null = null;
    api
      .blob(`/api/v1/documentos/${documento.id}/descarga?modo=ver`, control.signal)
      .then((b) => {
        url = URL.createObjectURL(b);
        setEstado({ tipo: "listo", url });
      })
      .catch((err: unknown) => {
        if (control.signal.aborted) return;
        setEstado({ tipo: "error", mensaje: err instanceof ApiError ? err.message : "No se pudo abrir el archivo" });
      });
    return () => {
      control.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [documento.id, se]);

  if (!se) {
    return (
      <Aviso>
        Los archivos {documento.nombre_original.split(".").pop()?.toUpperCase()} no se pueden ver aquí.{" "}
        <button type="button" onClick={onDescargar} className="font-bold text-white underline">
          Descárgalo
        </button>{" "}
        para revisarlo.
      </Aviso>
    );
  }
  if (estado.tipo === "cargando") return <Aviso>Abriendo el archivo…</Aviso>;
  if (estado.tipo === "error") return <Aviso>{estado.mensaje}</Aviso>;
  if (documento.mime_type === "application/pdf") {
    return <iframe title={`Vista previa de ${documento.nombre_original}`} src={estado.url} className="h-[62vh] min-h-[360px] w-full rounded-[6px] bg-white" />;
  }
  return <img src={estado.url} alt={`Vista previa de ${documento.nombre_original}`} className="mx-auto max-h-[62vh] max-w-full rounded-[6px] bg-white object-contain shadow-[0_10px_30px_-10px_rgba(0,0,0,0.5)]" />;
}

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-[260px] place-items-center rounded-[10px] border border-white/10 px-6 text-center text-[13.5px] text-white/75">
      <div>
        <Icono nombre="documento" size={30} className="mx-auto mb-3 text-white/50" />
        {children}
      </div>
    </div>
  );
}
