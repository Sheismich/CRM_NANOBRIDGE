import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentLoadingTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import workerUrl from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";

// PDF dibujado página por página con pdf.js. Se usa en el celular: Safari
// de iPhone enseña solo la primera página de un PDF en <iframe> (sin poder
// bajar) y Chrome de Android no lo enseña. Build "legacy" para que
// funcione también en iPhone con iOS viejo. Lo carga VistaPrevia con
// lazy(), así pdf.js no pesa en el resto del CRM.
GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PAGINAS = 30;

export default function PdfPaginas({ archivo, onDescargar }: { archivo: Blob; onDescargar: () => void }) {
  const contenedor = useRef<HTMLDivElement>(null);
  const [estado, setEstado] = useState<{ total: number } | { error: string } | null>(null);

  useEffect(() => {
    const div = contenedor.current;
    if (!div) return;
    let cancelado = false;
    let carga: PDFDocumentLoadingTask | null = null;

    void archivo.arrayBuffer().then(async (datos) => {
      if (cancelado) return;
      carga = getDocument({ data: new Uint8Array(datos) });
      try {
        const pdf = await carga.promise;
        if (cancelado) return;
        setEstado({ total: pdf.numPages });
        const ancho = div.clientWidth;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGINAS); n++) {
          const pagina = await pdf.getPage(n);
          if (cancelado) return;
          const base = pagina.getViewport({ scale: 1 });
          const vista = pagina.getViewport({ scale: (ancho / base.width) * dpr });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vista.width);
          canvas.height = Math.floor(vista.height);
          canvas.className = "block h-auto w-full rounded-[6px] bg-white";
          canvas.setAttribute("aria-label", `Página ${n}`);
          div.appendChild(canvas);
          await pagina.render({ canvas, viewport: vista }).promise;
        }
      } catch {
        if (!cancelado) setEstado({ error: "No se pudo mostrar el PDF." });
      }
    });

    return () => {
      cancelado = true;
      void carga?.destroy();
      div.replaceChildren();
    };
  }, [archivo]);

  return (
    <div>
      {estado === null && <p className="py-6 text-center text-[13px] text-white/75">Abriendo el archivo…</p>}
      {estado && "error" in estado && (
        <p className="py-6 text-center text-[13px] text-white/75">
          {estado.error}{" "}
          <button type="button" onClick={onDescargar} className="font-bold text-white underline">
            Descárgalo
          </button>{" "}
          para revisarlo.
        </p>
      )}
      <div ref={contenedor} className="flex flex-col gap-3" />
      {estado && "total" in estado && estado.total > MAX_PAGINAS && (
        <p className="mt-3 text-center text-[12.5px] text-white/75">
          Se ven las primeras {MAX_PAGINAS} de {estado.total} páginas.{" "}
          <button type="button" onClick={onDescargar} className="font-bold text-white underline">
            Descárgalo
          </button>{" "}
          para ver el resto.
        </p>
      )}
    </div>
  );
}
