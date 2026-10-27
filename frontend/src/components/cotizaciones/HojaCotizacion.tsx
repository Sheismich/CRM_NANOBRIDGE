import { fechaLocal, formatoFecha, formatoMoneda } from "../../lib/formato";

// La cotización "como documento" (docs/diseno/cotizaciones.html, .sheet):
// hoja blanca en día y en noche, como el PDF que sale de
// GET /cotizaciones/:id/pdf. La usan el panel de la cotización y el paso
// "Revisar y enviar" del editor, antes de guardar.

export type DatosHoja = {
  // null = todavía no se guarda (vista previa del editor).
  id: number | null;
  version: number;
  emitida: string | null;
  vigente: string | null;
  empresa: string;
  persona: string | null;
  oportunidad: string;
  etapa: string | null;
  partidas: { descripcion: string; detalle: string | null; cantidad: number; precio: number; importe: number }[];
  subtotal: number;
  descuento: number;
  impuestos: number;
  total: number;
  moneda: string;
};

export function HojaCotizacion({ datos: d }: { datos: DatosHoja }) {
  const emitida = d.emitida ? `Emitida ${formatoFecha.format(fechaLocal(d.emitida))}` : "Sin emitir";
  return (
    <div className="relative mx-3 my-3 overflow-hidden rounded-[6px] bg-white px-4 py-5 text-[#1b2240] shadow-[0_20px_40px_-20px_rgba(16,23,51,0.35)] md:mx-[22px] md:my-[22px] md:px-[34px] md:py-[30px]">
      <img src="/marca/n-color.svg" alt="" aria-hidden="true" className="pointer-events-none absolute -bottom-20 -right-14 w-[320px] -rotate-10 opacity-[.05]" />
      <div className="relative flex items-start justify-between gap-4 border-b-[3px] pb-4 [border-image:linear-gradient(90deg,#41e198,#23bad3,#2a449b,#5b2d86)_1]">
        <div className="flex items-center gap-2">
          <img src="/marca/n-color.svg" alt="" className="h-9 w-auto" />
          <b className="font-heading text-[15px] font-black tracking-[2px] text-[#2a449b]">NANOBRIDGE</b>
        </div>
        <div className="text-right">
          <b className="block font-heading text-[16px] font-black tracking-[2px] text-[#101733] md:text-[20px]">COTIZACIÓN</b>
          <span className="font-display text-[20px] text-[#2a449b] md:text-[22px]">{d.id ? `#${d.id} · v${d.version}` : `v${d.version}`}</span>
          <small className="mt-1 block text-[11px] text-[#5f6987]">
            {emitida}
            {d.vigente && ` · vigente al ${formatoFecha.format(fechaLocal(d.vigente))}`}
          </small>
        </div>
      </div>

      <div className="relative my-[18px] grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
        <Bloque titulo="Para" principal={d.empresa} secundario={d.persona} />
        <Bloque titulo="Oportunidad" principal={d.oportunidad} secundario={d.etapa} />
      </div>

      <table className="relative w-full border-collapse text-[12px] md:text-[13px]">
        <thead>
          <tr className="font-heading text-[10px] font-extrabold uppercase tracking-[1px] text-[#5f6987]">
            <th className="border-b border-[#e3e8f2] p-2 text-left">Concepto</th>
            <th className="border-b border-[#e3e8f2] p-2 text-right">Cant.</th>
            <th className="hidden border-b border-[#e3e8f2] p-2 text-right md:table-cell">Precio</th>
            <th className="border-b border-[#e3e8f2] p-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody>
          {d.partidas.map((p, i) => (
            <tr key={i} className="align-top">
              <td className="border-b border-[#eef1f9] px-2 py-2.5">
                <b>{p.descripcion}</b>
                {p.detalle && <small className="block text-[11px] text-[#5f6987]">{p.detalle}</small>}
              </td>
              <td className="whitespace-nowrap border-b border-[#eef1f9] px-2 py-2.5 text-right">{p.cantidad}</td>
              <td className="hidden whitespace-nowrap border-b border-[#eef1f9] px-2 py-2.5 text-right md:table-cell">{formatoMoneda.format(p.precio)}</td>
              <td className="whitespace-nowrap border-b border-[#eef1f9] px-2 py-2.5 text-right">{formatoMoneda.format(p.importe)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="relative ml-auto mt-3.5 w-full max-w-[260px] text-[13px]">
        <Renglon etiqueta="Subtotal" valor={formatoMoneda.format(d.subtotal)} />
        <Renglon etiqueta="Descuento" valor={`−${formatoMoneda.format(d.descuento)}`} />
        <Renglon etiqueta="Impuestos" valor={formatoMoneda.format(d.impuestos)} />
        <div className="mt-1.5 flex items-baseline justify-between border-t-2 border-[#101733] pt-2.5">
          <span className="font-extrabold text-[#101733]">Total {d.moneda}</span>
          <b className="font-display text-[22px] font-normal text-[#2a449b]">{formatoMoneda.format(d.total)}</b>
        </div>
      </div>
    </div>
  );
}

function Bloque({ titulo, principal, secundario }: { titulo: string; principal: string; secundario: string | null }) {
  return (
    <div>
      <small className="block font-heading text-[10px] font-extrabold uppercase tracking-[1.5px] text-[#5f6987]">{titulo}</small>
      <b className="mt-1 block text-[14px] text-[#101733]">{principal}</b>
      {secundario && <span className="text-[12px] text-[#5b6482]">{secundario}</span>}
    </div>
  );
}

function Renglon({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between py-[5px] text-[#5b6482]">
      <span>{etiqueta}</span>
      <b className="text-[#101733]">{valor}</b>
    </div>
  );
}
