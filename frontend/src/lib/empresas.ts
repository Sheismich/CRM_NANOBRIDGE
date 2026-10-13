import type { Tono } from "../components/ui/tonos";
import type { EmpresaFila, UltimaActividadDetalle } from "../types";
import { etiquetaEstadoProspecto } from "./prospectos";

// Pastilla de "Prospección" de la lista de Empresas (docs/diseno/empresas.html):
// en qué va su prospecto más reciente. Un validado que ya recibió correos
// está "En campaña N/3"; uno que contestó dice "Respondió".
export function prospeccionEmpresa(p: EmpresaFila["prospeccion"]): { texto: string; tono: Tono } {
  if (!p) return { texto: "Sin campaña", tono: "neutro" };
  if (p.estado === "validado" && p.envios > 0) return { texto: `En campaña ${Math.min(p.envios, 3)}/3`, tono: "navy" };
  if (p.estado === "interesado" || p.estado === "no_interesado") return { texto: "Respondió", tono: "ok" };
  if (p.estado === "en_revision") return { texto: "Por clasificar", tono: "warn" };
  if (p.estado === "excluido") return { texto: "Excluida", tono: "warn" };
  if (p.estado === "descartado") return { texto: "Descartada", tono: "warn" };
  if (p.estado === "inactivo") return { texto: "Inactiva", tono: "neutro" };
  if (p.estado === "baja") return { texto: "Baja", tono: "danger" };
  if (p.estado === "validado") return { texto: "Validada", tono: "info" };
  return { texto: etiquetaEstadoProspecto(p.estado), tono: "neutro" };
}

const ORDINAL = ["", "correo inicial", "1er recordatorio", "2º recordatorio"];
const CLASIFICACION: Record<string, string> = {
  interesado: "respondió interesada",
  no_interesado: "respondió: no le interesa",
  baja: "pidió su baja",
  ambigua: "respuesta por clasificar",
  automatica: "respuesta automática",
  invalido: "respuesta inválida",
  reagendar: "pidió que le escriban después"
};

// La línea chica debajo de la fecha de "Última actividad".
export function textoUltimaActividad(d: UltimaActividadDetalle | null) {
  if (!d) return "nunca";
  if (d.tipo === "envio") return ORDINAL[d.numero_contacto] ?? `correo #${d.numero_contacto}`;
  if (d.tipo === "respuesta") return d.clasificacion ? (CLASIFICACION[d.clasificacion] ?? "respondió") : "respuesta por clasificar";
  return { llamada: "llamada registrada", whatsapp: "WhatsApp registrado", comentario: "comentario" }[d.actividad_tipo] ?? "actividad";
}

// "Hoy, 09:42" / "Ayer" / "8 oct": fecha corta para listas.
const diaMes = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short" });
const hora = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });
export function fechaCorta(valor: string | Date) {
  const f = new Date(valor);
  const hoy = new Date();
  const ayer = new Date();
  ayer.setDate(hoy.getDate() - 1);
  if (f.toDateString() === hoy.toDateString()) return `Hoy, ${hora.format(f)}`;
  if (f.toDateString() === ayer.toDateString()) return "Ayer";
  return diaMes.format(f).replace(".", "");
}

// Más de 30 días sin nada (o nunca): la fecha se pinta apagada.
export function actividadVieja(valor: string | null) {
  return !valor || Date.now() - new Date(valor).getTime() > 30 * 86_400_000;
}
