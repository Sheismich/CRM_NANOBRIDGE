import { useQuery } from "@tanstack/react-query";
import type { DatosHoja } from "../components/cotizaciones/HojaCotizacion";
import type { Tono } from "../components/ui/tonos";
import type { CotizacionDocumento, CotizacionTablero, EstadoCotizacion, MotivoRechazoCotizacion } from "../types";
import { api } from "./api";
import { fechaLocal, formatoDiaMes } from "./formato";

// Catálogo de GET /cotizaciones/motivos-rechazo (no cambia mientras corre la app).
export function useMotivosRechazoCotizacion() {
  return useQuery({
    queryKey: ["cotizaciones-motivos-rechazo"],
    queryFn: () => api.get<{ clave: MotivoRechazoCotizacion; nombre: string }[]>("/api/v1/cotizaciones/motivos-rechazo"),
    staleTime: Infinity
  });
}

// Estados de cotización compartidos por la pestaña de la ficha y la
// pantalla de Cotizaciones.

export const ETIQUETA_ESTADO_COTIZACION: Record<EstadoCotizacion, string> = {
  borrador: "Borrador",
  enviada: "Enviada",
  aceptada: "Aceptada",
  rechazada: "Rechazada",
  vencida: "Vencida",
  obsoleta: "Obsoleta"
};

export function claseEstadoCotizacion(estado: EstadoCotizacion) {
  if (estado === "aceptada") return "bg-ok-bg text-ok";
  if (estado === "rechazada" || estado === "vencida") return "bg-danger-bg text-danger";
  if (estado === "enviada") return "bg-warn-bg text-warn";
  return "bg-bg text-ink-2";
}

// Rediseño (docs/diseno/cotizaciones.html): gris el borrador, azul la
// enviada, verde la aceptada, rojo la rechazada y ámbar la vencida.
export const TONO_ESTADO_COTIZACION: Record<EstadoCotizacion, Tono> = {
  borrador: "neutro",
  enviada: "navy",
  aceptada: "ok",
  rechazada: "danger",
  vencida: "warn",
  obsoleta: "neutro"
};

// Lo que pueden hacer las personas desde el documento. Mismas transiciones
// que TRANSICIONES en cotizaciones.service.ts, salvo "vencida": la marca
// sola el trabajo diario cuando pasa la fecha de cierre. Una vencida
// todavía se acepta o se rechaza si el cliente contesta tarde.
export const PUEDE_ENVIARSE = (estado: EstadoCotizacion) => estado === "borrador";
export const PUEDE_RESPONDERSE = (estado: EstadoCotizacion) => estado === "enviada" || estado === "vencida";
// Una aceptada no se versiona (409 COTIZACION_ACEPTADA) y una obsoleta ya
// tiene una más nueva.
export const PUEDE_VERSIONARSE = (estado: EstadoCotizacion) => estado !== "aceptada" && estado !== "obsoleta";

// Avisos de las tarjetas: una enviada sin respuesta en 5 días o que vence
// en 3 o menos pide seguimiento.
const DIAS_SIN_RESPUESTA = 5;
const DIAS_AVISO_VENCE = 3;

export function avisoCotizacion(c: CotizacionTablero, nombreMotivo: (clave: string) => string): { texto: string; tono: Tono; urgente: boolean } {
  const dia = (fecha: string) => formatoDiaMes.format(fechaLocal(fecha));
  switch (c.estado) {
    case "borrador":
      return { texto: "Falta enviar", tono: "neutro", urgente: false };
    case "enviada": {
      const vence = c.dias_para_cierre;
      if (vence != null && vence <= DIAS_AVISO_VENCE) {
        const texto = vence < 0 ? "Ya pasó su cierre" : vence === 0 ? "Vence hoy" : vence === 1 ? "Vence mañana" : `Vence en ${vence} días`;
        return { texto, tono: "warn", urgente: true };
      }
      if (c.dias_desde_envio != null && c.dias_desde_envio >= DIAS_SIN_RESPUESTA) {
        return { texto: `Sin respuesta hace ${c.dias_desde_envio} días`, tono: "warn", urgente: true };
      }
      if (c.fecha_esperada_cierre) return { texto: `Vigente al ${dia(c.fecha_esperada_cierre)}`, tono: "neutro", urgente: false };
      return { texto: c.fecha_envio ? `Enviada el ${dia(c.fecha_envio)}` : "Enviada", tono: "neutro", urgente: false };
    }
    case "aceptada":
      // actualizado_en: una aceptada ya no se toca, así que es el día en que
      // se aceptó (mismo criterio que /cotizaciones/conteos).
      return { texto: `Aceptada el ${formatoDiaMes.format(new Date(c.actualizado_en))}`, tono: "ok", urgente: false };
    case "rechazada":
      return { texto: c.motivo_rechazo ? `Motivo: ${nombreMotivo(c.motivo_rechazo).toLowerCase()}` : "Sin motivo registrado", tono: "danger", urgente: false };
    case "vencida":
      return { texto: c.fecha_esperada_cierre ? `Venció el ${dia(c.fecha_esperada_cierre)}` : "Pasó su cierre", tono: "warn", urgente: false };
    default:
      return { texto: ETIQUETA_ESTADO_COTIZACION[c.estado], tono: "neutro", urgente: false };
  }
}

// Días de calendario desde una fecha DATE hasta hoy ("Enviada · hace 5 días").
export function diasDesde(fecha: string) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  return Math.round((hoy.getTime() - fechaLocal(fecha).getTime()) / 86_400_000);
}

// GET /cotizaciones/:id: el panel de la cotización (encabezado y cuerpo).
export function useCotizacion(id: number) {
  return useQuery({
    queryKey: ["cotizacion", id],
    queryFn: () => api.get<CotizacionDocumento>(`/api/v1/cotizaciones/${id}`)
  });
}

export function hojaDeCotizacion(c: CotizacionDocumento): DatosHoja {
  return {
    id: c.id,
    version: c.version,
    emitida: c.fecha_emision,
    vigente: c.fecha_esperada_cierre,
    empresa: c.empresa_nombre_legal ?? c.empresa_nombre ?? `Empresa ${c.empresa_id}`,
    persona: c.contacto_nombre ? [c.contacto_nombre, c.contacto_puesto].filter(Boolean).join(" · ") : null,
    oportunidad: c.oportunidad_titulo ?? `Oportunidad ${c.oportunidad_id}`,
    etapa: [c.etapa_nombre, c.probabilidad != null ? `${c.probabilidad}%` : null].filter(Boolean).join(" · ") || null,
    partidas: c.partidas.map((p) => ({ descripcion: p.descripcion, detalle: p.detalle, cantidad: Number(p.cantidad), precio: Number(p.precio_unitario), importe: Number(p.importe) })),
    subtotal: Number(c.subtotal),
    descuento: Number(c.descuento),
    impuestos: Number(c.impuestos),
    total: Number(c.total),
    moneda: c.moneda
  };
}

// Campos del editor de cotizaciones (.fx2 del prototipo).
export const CLASE_CAMPO_EDITOR = "h-10 w-full rounded-[10px] border border-border bg-soft px-3 text-[14px] text-strong outline-none focus:border-cyan focus:bg-card focus:ring-[3px] focus:ring-info-bg";
