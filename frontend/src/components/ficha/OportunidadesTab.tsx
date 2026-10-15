import { useState } from "react";
import { clsx } from "clsx";
import { Avatar } from "../ui/Avatar";
import { Button } from "../ui/Button";
import { PanelLateral } from "../ui/PanelLateral";
import { Pastilla } from "../ui/Pastilla";
import { fechaLocal, formatoDiaMes, formatoMonedaEntera, plural } from "../../lib/formato";
import type { OportunidadTablero } from "../../types";
import { NuevaOportunidadForm } from "./NuevaOportunidadForm";
import { OportunidadDetallePanel } from "./OportunidadDetallePanel";
import { useOportunidadesEmpresa } from "./queries";

// Oportunidades de la empresa, con el estilo del tablero de Oportunidades:
// etapa, días en ella, responsable, cierre (rojo si ya pasó, ámbar si es
// este mes) y valor. Primero las abiertas, por cierre más próximo; luego
// las ganadas y perdidas. Al abrir una sale el mismo detalle que en
// Oportunidades, en el panel lateral.

function tonoEtapa(o: OportunidadTablero) {
  if (o.etapa_clave === "ganada") return "ok" as const;
  if (o.etapa_clave === "perdida") return "danger" as const;
  return "navy" as const;
}

// "venció 4 oct" (rojo), "cierra 24 oct" (ámbar si es este mes) o la fecha.
function cierre(o: OportunidadTablero) {
  if (o.cerrada) return { texto: o.etapa_clave === "ganada" ? `ganada el ${formatoDiaMes.format(new Date(o.actualizado_en))}` : `perdida el ${formatoDiaMes.format(new Date(o.actualizado_en))}`, clase: "text-ink-3" };
  if (!o.fecha_cierre_estimada) return { texto: "sin fecha de cierre", clase: "text-ink-3" };
  const f = fechaLocal(o.fecha_cierre_estimada);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  if (f < hoy) return { texto: `venció ${formatoDiaMes.format(f)}`, clase: "text-danger" };
  const esteMes = f.getMonth() === hoy.getMonth() && f.getFullYear() === hoy.getFullYear();
  return { texto: `cierra ${formatoDiaMes.format(f)}`, clase: esteMes ? "text-warn" : "text-ink-3" };
}

export function OportunidadesTab({ empresaId, contactos }: { empresaId: number; contactos: { id: number; nombre: string }[] }) {
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<OportunidadTablero | null>(null);

  const { data, isPending, isError } = useOportunidadesEmpresa(empresaId);
  const todas = data?.data ?? [];
  const abiertas = todas.filter((o) => !o.cerrada).sort((a, b) => (a.fecha_cierre_estimada ?? "9999").localeCompare(b.fecha_cierre_estimada ?? "9999"));
  const cerradas = todas.filter((o) => o.cerrada).sort((a, b) => b.actualizado_en.localeCompare(a.actualizado_en));
  const pipeline = abiertas.reduce((s, o) => s + Number(o.valor_estimado ?? 0), 0);

  return (
    <section className="tarjeta-blanca overflow-hidden !rounded-[18px]">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3.5 md:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="font-heading text-[14px] font-extrabold text-strong">Oportunidades</h2>
          {todas.length > 0 && (
            <p className="text-[12px] text-ink-3">
              {plural(abiertas.length, "abierta", "abiertas")} · {formatoMonedaEntera.format(pipeline)} en el pipeline
              {cerradas.length > 0 && ` · ${plural(cerradas.length, "cerrada", "cerradas")}`}
            </p>
          )}
        </div>
        {!creando && (
          <Button variant="outline" onClick={() => setCreando(true)}>
            + Nueva oportunidad
          </Button>
        )}
      </header>
      {creando && <NuevaOportunidadForm empresaId={empresaId} contactos={contactos} onDone={() => setCreando(false)} />}

      {isPending && <div className="p-5 text-sm text-ink-2">Cargando…</div>}
      {isError && <div className="p-5 text-sm text-danger">No se pudieron cargar las oportunidades.</div>}
      {data && todas.length === 0 && <div className="p-5 text-sm text-ink-3">Esta empresa no tiene oportunidades todavía.</div>}

      {todas.length > 0 && (
        <ul className="divide-y divide-border">
          {[...abiertas, ...cerradas].map((o) => {
            const c = cierre(o);
            return (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => setAbierta(o)}
                  className={clsx(
                    "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-soft md:grid-cols-[minmax(0,1fr)_170px_32px_minmax(0,150px)_130px] md:px-5",
                    abierta?.id === o.id && "bg-soft",
                    o.cerrada && "opacity-75"
                  )}
                >
                  <span className="min-w-0">
                    <b className="block truncate text-[14px] text-strong">{o.titulo}</b>
                    <small className="text-[12px] text-ink-3">
                      {o.cerrada ? `${o.probabilidad}%` : `${o.probabilidad}% · ${o.dias_en_etapa == null ? "—" : plural(o.dias_en_etapa, "día", "días")} en la etapa`}
                    </small>
                  </span>
                  <span className="justify-self-end md:justify-self-start">
                    <Pastilla tono={tonoEtapa(o)} punto>
                      {o.etapa_nombre}
                    </Pastilla>
                  </span>
                  <span className="hidden md:block" title={o.responsable_nombre ?? "Sin responsable"}>
                    <Avatar nombre={o.responsable_nombre} />
                  </span>
                  <span className={clsx("min-w-0 truncate text-[12px] font-bold", c.clase)}>{c.texto}</span>
                  <b className="mono justify-self-end font-display text-[18px] font-normal text-strong">{o.valor_estimado ? formatoMonedaEntera.format(Number(o.valor_estimado)) : "—"}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <PanelLateral
        abierto={abierta !== null}
        onCerrar={() => setAbierta(null)}
        encabezado={abierta && <h2 className="pt-1 font-heading text-[18px] font-black text-strong">{abierta.titulo}</h2>}
        cuerpoClassName="!p-0"
      >
        {abierta && <OportunidadDetallePanel enPanel id={abierta.id} tarjeta={abierta} onClose={() => setAbierta(null)} />}
      </PanelLateral>
    </section>
  );
}
