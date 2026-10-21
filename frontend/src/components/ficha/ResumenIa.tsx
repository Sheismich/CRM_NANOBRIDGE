import { useState } from "react";
import { Button } from "../ui/Button";
import { ServerError } from "../ui/Field";
import { Icono } from "../ui/Icono";
import { Tarjeta } from "../ui/Tarjeta";
import { ApiError } from "../../lib/api";
import { formatoFechaHora } from "../../lib/formato";
import { useGenerarResumen, useResumenFicha } from "../../lib/resumen-ficha";

// "Resumen con IA" en la pestaña Resumen de la ficha (etapa 4). La IA lee lo
// que tú puedes ver de esta empresa (historial, oportunidades, cotizaciones y
// tareas abiertas) y propone el siguiente paso. Se guarda tu último resumen;
// si después pasa algo nuevo, la tarjeta lo avisa para que lo actualices.
export function ResumenIa({ empresaId }: { empresaId: number }) {
  const { data, isPending, isError } = useResumenFicha(empresaId);
  const generar = useGenerarResumen(empresaId);
  const [generando, setGenerando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resumir() {
    setError(null);
    setGenerando(true);
    try {
      await generar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
    } finally {
      setGenerando(false);
    }
  }

  const bloqueo = !data ? null : !data.ia_activa ? "La IA todavía no está encendida." : !data.puede_generar ? data.motivo : null;
  const r = data?.resumen ?? null;

  return (
    <Tarjeta titulo="Resumen con IA" icono="chispas" color="morado">
      {isPending && <div className="text-[13px] text-ink-2">Cargando…</div>}
      {isError && <div className="text-[13px] text-danger">No se pudo cargar el resumen.</div>}
      {data && (
        <div className="flex flex-col gap-3">
          {r ? (
            <>
              <p className="text-[14px] leading-relaxed text-strong">{r.texto}</p>
              {r.siguiente_paso && (
                <div className="flex gap-2 rounded-[12px] border border-info/30 bg-info-bg px-3 py-2.5 text-[13px] text-info">
                  <Icono nombre="flechaDerecha" size={15} className="mt-0.5 shrink-0" />
                  <span>
                    <b className="font-extrabold">Siguiente paso:</b> {r.siguiente_paso}
                  </span>
                </div>
              )}
              {data.desactualizado && (
                <div className="flex items-center gap-2 rounded-[12px] border border-warn/40 bg-warn-bg px-3 py-2 text-[12.5px] font-semibold text-warn">
                  <Icono nombre="aviso" size={14} className="shrink-0" />
                  Hay movimientos nuevos desde este resumen.
                </div>
              )}
              <p className="text-[11.5px] text-ink-3">
                Lo hiciste con IA el {formatoFechaHora.format(new Date(r.creado_en))} a partir de lo que hay en el CRM. Puede equivocarse: revísalo antes de usarlo.
              </p>
            </>
          ) : (
            <p className="text-[13px] text-ink-2">Un resumen corto de lo que ha pasado con este cliente y el siguiente paso sugerido.</p>
          )}
          <ServerError message={error} />
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant={r ? "outline" : "primary"}
              className="px-3.5 py-2 text-[13px]"
              disabled={generando || bloqueo !== null}
              onClick={() => void resumir()}
            >
              <Icono nombre="chispas" size={15} /> {generando ? "Resumiendo…" : r ? "Actualizar" : "Resumir con IA"}
            </Button>
            {bloqueo && <span className="text-[12px] text-ink-3">{bloqueo}</span>}
          </div>
        </div>
      )}
    </Tarjeta>
  );
}
