import type { Tono } from "../components/ui/tonos";

// Estados de un prospecto (prospectos.estado es varchar en la base; estos
// son los que escriben la API y n8n: alta en "capturado", PT1 lo pasa a
// "validado" o "excluido", la clasificación de una respuesta a
// interesado / no_interesado / en_revision / descartado, y las bajas a
// "baja"; "inactivo" lo pone PT4 al terminar la secuencia).
export const ETIQUETA_ESTADO_PROSPECTO: Record<string, string> = {
  capturado: "Capturado",
  validado: "Validado",
  excluido: "Excluido",
  interesado: "Interesado",
  no_interesado: "No interesado",
  en_revision: "En revisión",
  descartado: "Descartado",
  inactivo: "Inactivo",
  baja: "Baja"
};

export const TONO_ESTADO_PROSPECTO: Record<string, Tono> = {
  capturado: "neutro",
  validado: "info",
  excluido: "warn",
  interesado: "ok",
  no_interesado: "neutro",
  en_revision: "warn",
  descartado: "warn",
  inactivo: "neutro",
  baja: "danger"
};

export function etiquetaEstadoProspecto(estado: string) {
  return ETIQUETA_ESTADO_PROSPECTO[estado] ?? estado.replace(/_/g, " ");
}

// Tarjetas del embudo de Prospectos (docs/diseno/prospectos.html). Cada una
// junta uno o varios estados. "En campaña" no es un estado: son los que ya
// recibieron al menos un correo (GET /prospectos/conteos → contactados), y
// se cruzan con validados y respondieron, por eso no filtra la lista.
export type GrupoEmbudo = {
  id: string;
  etiqueta: string;
  estados: string[] | null;
  detalle: string;
  tono: Tono;
  aparte?: boolean;
};

export const GRUPOS_EMBUDO: GrupoEmbudo[] = [
  { id: "capturados", etiqueta: "Capturados", estados: ["capturado"], detalle: "falta validar", tono: "neutro" },
  { id: "validados", etiqueta: "Validados", estados: ["validado"], detalle: "listos para campaña", tono: "info" },
  { id: "en_campana", etiqueta: "En campaña", estados: null, detalle: "ya recibieron correo", tono: "navy" },
  { id: "respondieron", etiqueta: "Respondieron", estados: ["interesado", "no_interesado", "en_revision"], detalle: "", tono: "ok" },
  { id: "excluidos", etiqueta: "Excluidos", estados: ["excluido", "descartado", "inactivo"], detalle: "sin giro o medio", tono: "warn", aparte: true },
  { id: "baja", etiqueta: "Baja", estados: ["baja"], detalle: "no volver a escribir", tono: "danger", aparte: true }
];

// Color del anillo del score (0-100): verde desde 80, ámbar desde 60.
export function tonoScore(score: number): Tono {
  if (score >= 80) return "ok";
  if (score >= 60) return "warn";
  return "danger";
}
