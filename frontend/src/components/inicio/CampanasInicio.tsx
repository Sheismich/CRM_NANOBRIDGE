import { Link } from "react-router-dom";
import { clsx } from "clsx";
import { Pastilla } from "../ui/Pastilla";
import type { Tono } from "../ui/tonos";
import { pct } from "../../lib/inicio";
import { plural } from "../../lib/formato";
import type { Campana, EstadoCampana } from "../../lib/campanas";
import type { ReporteProspeccion } from "../../types";

// Campañas del Inicio: una fila por campaña que mandó correos este mes, con
// su estado (de GET /campanas), contactadas/respondieron, la tasa en grande
// y una barra. La barra se llena al 25 % de respuesta: más que eso ya es
// excelente para correo en frío.
const TONO_ESTADO: Record<EstadoCampana, Tono> = { activa: "ok", pausada: "warn", borrador: "neutro", finalizada: "neutro" };
const ETIQUETA_ESTADO: Record<EstadoCampana, string> = { activa: "Activa", pausada: "Pausada", borrador: "Borrador", finalizada: "Finalizada" };

export function CampanasInicio({ porCampana, campanas }: { porCampana: ReporteProspeccion["por_campana"]; campanas: Campana[] }) {
  if (porCampana.length === 0) {
    return (
      <p className="py-2 text-[13px] text-ink-2">
        Ninguna campaña ha mandado correos este mes.{" "}
        <Link to="/prospectos?tab=campanas" className="font-bold text-navy hover:underline">
          Ver campañas
        </Link>
      </p>
    );
  }
  const porId = new Map(campanas.map((c) => [c.id, c]));
  return (
    <div>
      {porCampana.map((c) => {
        const campana = c.campana_id != null ? porId.get(c.campana_id) : undefined;
        const apagada = campana && campana.estado !== "activa";
        const tasa = c.tasa_respuesta_pct ?? 0;
        return (
          <Link
            key={c.campana_id ?? "sin"}
            to="/prospectos?tab=campanas"
            className="grid grid-cols-[1fr_64px] items-center gap-x-4 gap-y-2.5 border-t border-[var(--relieve-linea)] py-3 text-[13px] first:border-t-0 first:pt-0 md:grid-cols-[1fr_80px_150px]"
          >
            <div className="min-w-0">
              <span className="font-bold text-strong">{c.campana_nombre}</span>
              {campana && (
                <Pastilla tono={TONO_ESTADO[campana.estado]} className="ml-1.5">
                  {ETIQUETA_ESTADO[campana.estado]}
                </Pastilla>
              )}
              <small className="block text-[12px] text-ink-3">
                {plural(c.personas_contactadas, "contactada", "contactadas")} · {plural(c.personas_que_respondieron, "respondió", "respondieron")}
                {c.interesados > 0 && ` · ${plural(c.interesados, "interesado", "interesados")}`}
              </small>
            </div>
            <div className="mono text-right font-display text-[24px] text-strong">{pct(c.tasa_respuesta_pct)}</div>
            <div className="col-span-2 h-2 overflow-hidden rounded-full shadow-[var(--relieve-hundido)] md:col-span-1">
              <b className={clsx("block h-full bg-[linear-gradient(90deg,var(--mint),var(--cyan))] shadow-[0_0_10px_rgba(35,186,211,0.6)]", apagada && "opacity-50")} style={{ width: `${Math.min(100, tasa * 4)}%` }} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
