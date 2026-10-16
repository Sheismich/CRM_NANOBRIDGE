import { Pastilla } from "../ui/Pastilla";
import { ETIQUETA_REVISION, TONO_REVISION } from "../../lib/documentos";
import type { ExpedienteVenta as Venta, PapelExpediente } from "../../types";

// Expediente de una venta (16-oct-2026, GET /documentos/expediente/:empresaId):
// cotización, comprobante de pago y comprobante de recibido o guía; si la
// venta lleva factura, también la constancia de situación fiscal. Cuenta
// solo lo aprobado. La cotización se cumple sola con la aceptada del CRM.
// Lo usan la ficha de la empresa y el panel de la oportunidad (el de
// Documentos lo pinta con sus tarjetitas).

function textoPapel(p: PapelExpediente) {
  if (p.origen === "cotizacion_crm") return `${p.nombre}: aceptada en el CRM`;
  return `${p.nombre}: ${p.estado === "falta" ? "falta" : ETIQUETA_REVISION[p.estado].toLowerCase()}`;
}

export function ExpedienteVenta({ venta, conTitulo = true }: { venta: Venta; conTitulo?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {conTitulo ? (
          <span className="min-w-0 text-[13px] font-bold text-strong">
            {venta.titulo}
            <span className="ml-1.5 font-normal text-ink-3">{venta.ganada ? "· Ganada" : "· Abierta"}</span>
          </span>
        ) : (
          <span className="text-[13px] font-bold text-strong">Expediente</span>
        )}
        <Pastilla tono={venta.completo ? "ok" : venta.ganada ? "warn" : "neutro"}>{`${venta.aprobados} de ${venta.total} aprobados`}</Pastilla>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {venta.papeles.map((p) => (
          <Pastilla key={p.tipo_id} tono={p.estado === "falta" ? "neutro" : TONO_REVISION[p.estado]} punto>
            {textoPapel(p)}
          </Pastilla>
        ))}
      </div>
      {!venta.ganada && !venta.completo && <p className="text-[12px] text-ink-3">Se exige cuando la venta se gane; por ahora es avance.</p>}
    </div>
  );
}
