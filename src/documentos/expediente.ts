// Expediente por venta (16-oct-2026): qué papeles pide cada oportunidad y
// en qué estado va cada uno. Una sola regla para el expediente de la ficha
// (GET /documentos/expediente/:empresaId) y para el contador "Expedientes
// incompletos" (GET /documentos/conteos), así nunca dicen cosas distintas.
//
// - Papel de alcance 'venta': se busca entre los documentos de esa
//   oportunidad. De alcance 'empresa' (la constancia fiscal, y cualquier
//   tipo viejo que un administrador marque obligatorio): entre todos los de
//   la empresa, así una constancia aprobada sirve para todas sus ventas.
// - solo_con_factura: solo se pide si la venta lleva factura.
// - La cotización se cumple sola con una cotización aceptada del CRM; si
//   no, con un documento de tipo Cotización o Cotización firmada.
// - Cuenta solo lo aprobado; con varios vigentes del mismo papel gana el de
//   mejor estado (uno aprobado no lo tumba un duplicado rechazado).

export const CLAVE_COTIZACION = "cotizacion";
export const CLAVE_COTIZACION_FIRMADA = "cotizacion_firmada";

// Orden en que se enseñan: el de la venta (cotizar, cobrar, entregar) y al
// final la constancia; cualquier otro obligatorio después, por nombre.
const ORDEN_PAPELES = ["cotizacion", "comprobante_pago", "comprobante_recibido", "constancia_situacion_fiscal"];

export const RANGO_REVISION = { aprobado: 3, por_revisar: 2, rechazado: 1 } as const;
export type Revision = keyof typeof RANGO_REVISION;

export type TipoObligatorio = { id: number; clave: string; nombre: string; alcance: "venta" | "empresa"; soloConFactura: boolean };

// Documentos vigentes y activos de la empresa, del más reciente al más viejo.
export type DocumentoDeExpediente = {
  id: number;
  oportunidadId: number | null;
  tipoDocumentoId: number | null;
  revision: Revision;
  nombreOriginal: string;
  version: number;
  creadoEn: Date;
  revisadoEn: Date | null;
  motivoRechazo: string | null;
  motivoRechazoDetalle: string | null;
};

export type VentaDeExpediente = { id: number; titulo: string; ganada: boolean; llevaFactura: boolean };

export function ordenarTipos(tipos: TipoObligatorio[]) {
  const lugar = (clave: string) => (ORDEN_PAPELES.includes(clave) ? ORDEN_PAPELES.indexOf(clave) : ORDEN_PAPELES.length);
  return [...tipos].sort((a, b) => lugar(a.clave) - lugar(b.clave) || a.nombre.localeCompare(b.nombre, "es"));
}

export function evaluarVenta(
  venta: VentaDeExpediente,
  tipos: TipoObligatorio[],
  docs: DocumentoDeExpediente[],
  cotizacionAceptada: { id: number; version: number } | undefined,
  idCotizacionFirmada: number | undefined
) {
  const papeles = ordenarTipos(tipos)
    .filter((tipo) => !tipo.soloConFactura || venta.llevaFactura)
    .map((tipo) => {
      const base = { tipo_id: tipo.id, clave: tipo.clave, nombre: tipo.nombre, alcance: tipo.alcance };
      if (tipo.clave === CLAVE_COTIZACION && cotizacionAceptada) {
        return { ...base, estado: "aprobado" as const, origen: "cotizacion_crm" as const, documento: null, cotizacion: cotizacionAceptada };
      }
      const delTipo = docs.filter((d) =>
        (d.tipoDocumentoId === tipo.id || (tipo.clave === CLAVE_COTIZACION && idCotizacionFirmada !== undefined && d.tipoDocumentoId === idCotizacionFirmada)) &&
        (tipo.alcance === "empresa" || d.oportunidadId === venta.id)
      );
      // sort es estable: a igual estado, queda el más reciente.
      const mejor = [...delTipo].sort((a, b) => RANGO_REVISION[b.revision] - RANGO_REVISION[a.revision])[0];
      if (!mejor) return { ...base, estado: "falta" as const, origen: null, documento: null, cotizacion: null };
      return {
        ...base,
        estado: mejor.revision,
        origen: "documento" as const,
        documento: { id: mejor.id, nombre_original: mejor.nombreOriginal, version: mejor.version, creado_en: mejor.creadoEn, revisado_en: mejor.revisadoEn, motivo_rechazo: mejor.motivoRechazo, motivo_rechazo_detalle: mejor.motivoRechazoDetalle },
        cotizacion: null
      };
    });
  const aprobados = papeles.filter((p) => p.estado === "aprobado").length;
  return {
    oportunidad_id: venta.id,
    titulo: venta.titulo,
    ganada: venta.ganada,
    lleva_factura: venta.llevaFactura,
    papeles,
    aprobados,
    total: papeles.length,
    completo: aprobados === papeles.length
  };
}
