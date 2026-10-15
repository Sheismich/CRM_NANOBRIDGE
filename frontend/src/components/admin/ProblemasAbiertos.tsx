import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { Button } from "../ui/Button";
import { inputBaseClass } from "../ui/Field";
import { ApiError, api } from "../../lib/api";
import { diaCorto, isoDia } from "../../lib/inicio";
import { plural } from "../../lib/formato";
import type { GrupoProblemas } from "../../types";

// "Problemas abiertos agrupados por causa" (punto 39): cada grupo es una
// misma causa. Los avisos de la API a n8n se pueden reintentar todos
// juntos; las fallas dentro de un workflow de n8n solo se marcan resueltas
// (el arreglo es en n8n). "Ver los N" abre el detalle técnico de siempre.

const COLOR_GRUPO: Record<GrupoProblemas["tipo"], string> = {
  aviso_api: "bg-warn-bg text-warn",
  workflow_n8n: "bg-danger-bg text-danger",
  otro: "bg-soft text-ink-2"
};

type Mensaje = { texto: string; tono: "ok" | "warn" | "danger" };

export function ProblemasAbiertos({ onVerDetalle }: { onVerDetalle: () => void }) {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useState<"" | "resuelto">("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const { data, isPending, isError } = useQuery({
    queryKey: ["admin", "problemas", estado],
    queryFn: () => api.get<{ grupos: GrupoProblemas[] }>("/api/v1/admin/problemas", { estado: estado || undefined })
  });

  async function actuar(clave: string, que: "reintentar" | "resolver" | "despachar") {
    setOcupado(clave);
    setMensaje(null);
    try {
      if (que === "despachar") {
        const r = await api.post<{ procesados: number; sin_destino?: true }>("/api/v1/eventos-pendientes/despachar");
        setMensaje(r.sin_destino ? { texto: "n8n todavía no tiene a dónde recibir avisos: los avisos se quedan en espera y salen cuando se configure la dirección.", tono: "warn" } : { texto: `${plural(r.procesados, "aviso salió", "avisos salieron")} hacia n8n.`, tono: "ok" });
      } else if (que === "reintentar") {
        const r = await api.post<{ reintentados: number; resueltos: number; sin_destino?: true }>("/api/v1/admin/problemas/reintentar", { clave });
        setMensaje({
          texto: `${plural(r.reintentados, "aviso volvió", "avisos volvieron")} a la cola.${r.sin_destino ? " Ojo: n8n todavía no tiene dirección, así que esperan ahí hasta que se configure." : ""}`,
          tono: r.sin_destino ? "warn" : "ok"
        });
      } else {
        const r = await api.post<{ resueltos: number }>("/api/v1/admin/problemas/resolver", { clave });
        setMensaje({ texto: `${plural(r.resueltos, "problema marcado", "problemas marcados")} como resuelto${r.resueltos === 1 ? "" : "s"}.`, tono: "ok" });
      }
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    } catch (err) {
      setMensaje({ texto: err instanceof ApiError ? err.message : "No se pudo conectar con el servidor", tono: "danger" });
    } finally {
      setOcupado(null);
    }
  }

  const grupos = data?.grupos ?? [];
  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3.5 md:px-5">
        <h2 className="font-heading text-[15px] font-extrabold text-strong">Problemas abiertos</h2>
        <span className="text-[12.5px] text-ink-3">agrupados por causa</span>
        <select aria-label="Estado" className={`${inputBaseClass} ml-auto h-9 w-auto`} value={estado} onChange={(e) => setEstado(e.target.value as "" | "resuelto")}>
          <option value="">Abiertos</option>
          <option value="resuelto">Resueltos</option>
        </select>
        <Button variant="outline" disabled={ocupado !== null} onClick={() => void actuar("", "despachar")} title="Manda ya los avisos que esperan en la cola">
          Despachar ahora
        </Button>
      </header>
      {mensaje && (
        <p className={clsx("border-b border-border px-5 py-2.5 text-[13px]", mensaje.tono === "ok" ? "bg-ok-bg text-ok" : mensaje.tono === "warn" ? "bg-warn-bg text-warn" : "bg-danger-bg text-danger")}>{mensaje.texto}</p>
      )}
      {isPending && <p className="p-5 text-[13px] text-ink-3">Cargando…</p>}
      {isError && <p className="p-5 text-[13px] text-danger">No se pudieron cargar los problemas.</p>}
      {data && grupos.length === 0 && <p className="p-5 text-[13px] text-ink-2">{estado ? "Todavía no hay problemas resueltos." : "No hay problemas abiertos."}</p>}
      <ul>
        {grupos.map((g) => (
          <li key={g.clave} className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border px-4 py-4 first:border-t-0 md:flex-nowrap md:px-5">
            <span className={clsx("mono grid h-11 w-11 shrink-0 place-items-center rounded-[12px] font-display text-[22px]", COLOR_GRUPO[g.tipo])}>{g.cantidad}</span>
            <div className="min-w-0 flex-1">
              <b className="block text-[14px] text-strong">{titulo(g)}</b>
              <p className="mt-0.5 text-[13px] text-ink-2">{g.tipo === "workflow_n8n" ? g.mensaje : explicacion(g)}</p>
              {g.tipos_evento.length > 0 && (
                <code className="mt-2 inline-block rounded-[8px] border border-border bg-soft px-2.5 py-1.5 font-mono text-[11.5px] text-ink-2">
                  {g.tipos_evento.map((t) => (t.cantidad > 1 ? `${t.tipo} ×${t.cantidad}` : t.tipo)).join(" · ")} — {rango(g)}
                </code>
              )}
              {g.tipos_evento.length === 0 && <small className="mt-1 block text-[11.5px] text-ink-3">{rango(g)}</small>}
            </div>
            {!estado && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button variant="outline" onClick={onVerDetalle}>
                  Ver {g.cantidad === 1 ? "detalle" : `los ${g.cantidad}`}
                </Button>
                {g.acciones.includes("reintentar") && (
                  <Button disabled={ocupado !== null} onClick={() => void actuar(g.clave, "reintentar")}>
                    {ocupado === g.clave ? "…" : g.cantidad === 1 ? "Reintentar" : "Reintentar todos"}
                  </Button>
                )}
                {g.acciones.includes("resolver") && !g.acciones.includes("reintentar") && (
                  <Button variant="outline" disabled={ocupado !== null} onClick={() => void actuar(g.clave, "resolver")}>
                    {ocupado === g.clave ? "…" : g.cantidad === 1 ? "Marcar resuelto" : "Marcar resueltos"}
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function titulo(g: GrupoProblemas) {
  if (g.tipo === "aviso_api") return g.cantidad === 1 ? "1 aviso a n8n no salió" : `${g.cantidad} avisos a n8n no salieron por la misma causa`;
  if (g.tipo === "workflow_n8n") return `${g.workflow ?? "Workflow de n8n"}${g.nodo ? ` — “${g.nodo}”` : ""}`;
  return g.mensaje;
}

function explicacion(g: GrupoProblemas) {
  return g.mensaje.length > 220 ? `${g.mensaje.slice(0, 220)}…` : g.mensaje;
}

function rango(g: GrupoProblemas) {
  const d = isoDia(new Date(g.desde));
  const h = isoDia(new Date(g.hasta));
  return d === h ? `el ${diaCorto(d)}` : `del ${diaCorto(d)} al ${diaCorto(h)}`;
}
