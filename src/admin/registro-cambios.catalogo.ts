import { and, eq, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { auditoria } from "../database/schema.js";

// Qué entra al Registro de cambios y en qué filtro (Fabián, 12-oct-2026).
// Reportes · Día es el TRABAJO (tareas, correos, respuestas, bajas);
// Administración es el CONTROL: quién movió qué. Por eso aquí solo entran
// acciones de una persona (usuario_id no nulo) y de esta lista; lo demás
// (tareas creadas/cerradas/tomadas, clasificar respuestas, actividades y todo
// lo que hace la automatización sola) se queda fuera a propósito.
//
// Si mañana se audita una acción nueva, no sale aquí hasta agregarla.

export const TIPOS_REGISTRO = ["usuarios_roles", "ediciones", "borrados", "descargas", "configuracion"] as const;
export type TipoRegistro = (typeof TIPOS_REGISTRO)[number];

// Entidad → acción → cómo se llama en el filtro "Acción" y en el PDF. Va todo
// junto para que una acción nueva no pueda entrar sin su nombre.
const REGLAS: Record<TipoRegistro, Record<string, Record<string, string>>> = {
  usuarios_roles: {
    usuario: { crear: "Alta de usuario", actualizar: "Edición o cambio de rol de usuario", desactivar: "Desactivación de usuario", reactivar: "Reactivación de usuario" }
  },
  ediciones: {
    empresa: { crear: "Alta de empresa", actualizar: "Edición de empresa", tomar_empresa: "Empresa asignada" },
    contacto: { crear: "Alta de contacto", actualizar: "Edición de contacto" },
    oportunidad: { crear: "Alta de oportunidad", cambiar_etapa: "Cambio de etapa de oportunidad", reabrir: "Reapertura de oportunidad" },
    cotizacion: { crear: "Alta de cotización", nueva_version: "Versión nueva de cotización", cambiar_estado: "Cambio de estado de cotización" },
    documento: { subir: "Documento subido", nueva_version: "Versión nueva de documento", cambiar_estado: "Cambio de estado de documento", revisar: "Documento revisado", aprobar: "Documento aprobado", rechazar: "Documento rechazado" },
    prospecto: { importar_borrador: "Prospecto importado" }
  },
  borrados: {
    documento: { eliminar: "Documento eliminado" },
    empresa: { desactivar: "Baja de empresa" },
    contacto: { desactivar: "Baja de contacto" },
    medio_contacto: { registrar_supresion: "Medio marcado como no contactar" }
    // + el prospecto que una persona pasó a "baja" (ver condicionBajaManual).
  },
  descargas: {
    documento: { ver: "Documento visto", descargar: "Documento descargado", descargar_lote: "Lote de documentos descargado" },
    reporte: { exportar: "Reporte exportado" },
    cotizacion: { descargar_pdf: "PDF de cotización descargado" },
    registro_cambios: { exportar: "Registro de cambios exportado" }
  },
  configuracion: {
    campana: { crear: "Alta de campaña", editar: "Edición de campaña", activar: "Campaña activada", pausar: "Campaña pausada", finalizar: "Campaña finalizada" },
    plantilla_correo: { editar: "Edición de correo de prospección" },
    pie_correo: { editar: "Edición del pie de correos" },
    reparto_interesados: { editar: "Cambio del reparto de interesados" },
    freno_dominio: { pausar: "Envíos pausados", reanudar: "Envíos reanudados" },
    catalogo_tipo_documento: { cambiar_obligatorio: "Cambio de papeles obligatorios" },
    evento_pendiente: { reintentar: "Aviso a n8n reintentado" },
    proceso_fallido: { cambiar_estado: "Cambio de estado de un problema" }
  }
};

// La baja de un prospecto no es un verbo sino un resultado (ver
// condicionBajaManual): en el filtro "Acción" usa esta clave.
const CLAVE_BAJA_PROSPECTO = "prospecto:baja";

export interface AccionRegistro {
  clave: string; // "entidad:accion"
  etiqueta: string;
  tipo: TipoRegistro;
}

// Las opciones del filtro "Acción". Entidad y verbo van juntos porque el verbo
// solo no dice nada: "crear" sirve igual para una empresa que para un usuario.
export const ACCIONES_REGISTRO: AccionRegistro[] = TIPOS_REGISTRO.flatMap((tipo) => [
  ...Object.entries(REGLAS[tipo]).flatMap(([entidad, acciones]) => Object.entries(acciones).map(([accion, etiqueta]) => ({ clave: `${entidad}:${accion}`, etiqueta, tipo }))),
  ...(tipo === "borrados" ? [{ clave: CLAVE_BAJA_PROSPECTO, etiqueta: "Baja de prospecto", tipo }] : [])
]);

export const CLAVES_ACCION = ACCIONES_REGISTRO.map((a) => a.clave) as [string, ...string[]];
const POR_CLAVE = new Map(ACCIONES_REGISTRO.map((a) => [a.clave, a]));

// Una baja hecha por una persona (desde la cola de clasificación, por
// ejemplo) sí es un "borrado", venga de la acción que venga; la que llega sola
// del link o de una queja la registra la automatización, sin usuario, y ya no
// entra por eso.
const condicionBajaManual = and(
  eq(auditoria.entidad, "prospecto"),
  sql`JSON_UNQUOTE(JSON_EXTRACT(${auditoria.despues}, '$.estado')) = 'baja'`
)!;

function condicionDe(tipo: TipoRegistro): SQL {
  const partes = Object.entries(REGLAS[tipo]).map(([entidad, acciones]) => and(eq(auditoria.entidad, entidad), inArray(auditoria.accion, Object.keys(acciones)))!);
  if (tipo === "borrados") partes.push(condicionBajaManual);
  return or(...partes)!;
}

/** Condición SQL del filtro ("todo" = la suma de los cinco), siempre con una persona detrás. */
export function condicionRegistro(tipo: TipoRegistro | "todo"): SQL {
  const condicion = tipo === "todo" ? or(...TIPOS_REGISTRO.map(condicionDe))! : condicionDe(tipo);
  // Solo acciones de personas, más la pausa automática del freno.
  return and(or(isNotNull(auditoria.usuarioId), eq(auditoria.entidad, "freno_dominio")), condicion)!;
}

/** Condición SQL de una acción del catálogo; siempre va junto con condicionRegistro. */
export function condicionAccion(clave: string): SQL {
  if (clave === CLAVE_BAJA_PROSPECTO) return condicionBajaManual;
  const [entidad, accion] = clave.split(":") as [string, string];
  return and(eq(auditoria.entidad, entidad), eq(auditoria.accion, accion))!;
}

export function etiquetaAccion(clave: string): string {
  return POR_CLAVE.get(clave)?.etiqueta ?? clave;
}

/** En qué filtro cae una fila (para etiquetarla en la lista "Todo"). */
export function tipoDeFila(entidad: string, accion: string, despues: unknown): TipoRegistro | null {
  if (entidad === "prospecto" && (despues as { estado?: string } | null)?.estado === "baja") return "borrados";
  return POR_CLAVE.get(`${entidad}:${accion}`)?.tipo ?? null;
}
