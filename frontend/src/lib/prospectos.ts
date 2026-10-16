import type { Tono } from "../components/ui/tonos";

// Estados de un prospecto (prospectos.estado es varchar en la base; estos
// son los que escriben la API y n8n: alta en "capturado", el botón "Mandar a
// automatización" lo pasa a "en_fila" (16-oct-2026), PT1 a "validado" o
// "excluido", la clasificación de una respuesta a interesado /
// no_interesado / en_revision / descartado, y las bajas a "baja";
// "inactivo" lo pone PT4 al terminar la secuencia).
export const ETIQUETA_ESTADO_PROSPECTO: Record<string, string> = {
  capturado: "Capturado",
  en_fila: "En fila",
  validado: "Validado",
  excluido: "Excluido",
  interesado: "Interesado",
  no_interesado: "No interesado",
  en_revision: "En revisión",
  descartado: "Descartado",
  inactivo: "Inactivo",
  baja: "Baja",
  // No es un estado guardado (ver EN_CAMPANA): solo para el selector de Estado.
  en_campana: "En campaña"
};

export const TONO_ESTADO_PROSPECTO: Record<string, Tono> = {
  capturado: "neutro",
  en_fila: "info",
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
// junta uno o varios estados. "En campaña" no es un estado guardado: es un
// validado que ya recibió correo (GET /prospectos/conteos → en_campana desde
// el 15-oct-2026), y "Validados" son los que aún no reciben ninguno, así que
// las tarjetas ya no se cruzan. Las dos filtran con enCampana (filtroEstado).
export const EN_CAMPANA = "en_campana";

// Lo que va a GET /prospectos según el estado elegido en el embudo o el selector.
export function filtroEstado(estado: string): { estado?: string; enCampana?: "true" | "false" } {
  if (estado === EN_CAMPANA) return { enCampana: "true" };
  if (estado === "validado") return { estado, enCampana: "false" };
  return estado ? { estado } : {};
}

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
  { id: "en_fila", etiqueta: "En fila", estados: ["en_fila"], detalle: "salen solos, unos 6 a 10 al día", tono: "info" },
  { id: "validados", etiqueta: "Validados", estados: ["validado"], detalle: "listos para campaña", tono: "info" },
  { id: "en_campana", etiqueta: "En campaña", estados: [EN_CAMPANA], detalle: "esperan respuesta", tono: "navy" },
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

// --- Fila de automatización (botón "Mandar a automatización", 16-oct-2026) ---

// Se pueden mandar los capturados y los excluidos (a uno excluido se le
// corrigió el dato que faltaba). Uno que ya está en la fila sin que PT1 lo
// haya tomado también entra, pero solo para cambiarle la campaña.
export function sePuedeMandar(p: { estado: string; fila_tomado_en: string | null }) {
  return p.estado === "capturado" || p.estado === "excluido" || (p.estado === "en_fila" && p.fila_tomado_en === null);
}

// Por qué no entró a la fila (POST /prospectos/automatizacion → rechazados,
// src/shared/listo-para-automatizacion.ts) o por qué se excluyó la vez
// pasada (motivo_exclusion_anterior: Validaciones de PT1 o la verificación
// de envío). Lo que no esté aquí ya viene en texto desde n8n y se enseña tal cual.
const TEXTO_MOTIVO: Record<string, string> = {
  giro_no_informado: "le falta el giro de la empresa",
  tamano_no_informado: "le falta el tamaño de la empresa",
  sin_correo: "no tiene un correo activo",
  sin_medio_de_contacto_activo: "no tenía un medio de contacto activo",
  suprimido: "su correo está en la lista de supresión",
  en_baja: "la persona pidió su baja",
  prospecto_en_baja: "la persona pidió su baja",
  contacto_desactivado: "el contacto o la empresa están desactivados",
  maximo_contactos: "ya se le escribió 3 veces; hay que esperar 6 meses",
  ventana_activa: "ya va en otra campaña esperando respuesta",
  ya_en_fila: "la misma persona ya está en la fila con otro prospecto",
  ya_tomado: "la automatización ya lo tomó",
  estado_no_permitido: "solo se mandan los capturados y los excluidos",
  no_encontrado: "ya no existe"
};

export function textoMotivo(motivo: string) {
  return TEXTO_MOTIVO[motivo] ?? motivo;
}

export function textoMotivos(motivos: string[]) {
  return motivos.map(textoMotivo).join("; ");
}
