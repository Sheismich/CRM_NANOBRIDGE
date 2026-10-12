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

const REGLAS: Record<TipoRegistro, Record<string, string[]>> = {
  usuarios_roles: {
    usuario: ["crear", "actualizar", "desactivar", "reactivar"]
  },
  ediciones: {
    empresa: ["crear", "actualizar", "tomar_empresa"],
    contacto: ["crear", "actualizar"],
    oportunidad: ["crear", "cambiar_etapa", "reabrir"],
    cotizacion: ["crear", "nueva_version", "cambiar_estado"],
    documento: ["subir", "nueva_version", "cambiar_estado", "revisar", "aprobar", "rechazar"],
    prospecto: ["importar_borrador"]
  },
  borrados: {
    documento: ["eliminar"],
    empresa: ["desactivar"],
    contacto: ["desactivar"],
    medio_contacto: ["registrar_supresion"]
    // + el prospecto que una persona pasó a "baja" (ver condicionBajaManual).
  },
  descargas: {
    documento: ["ver", "descargar", "descargar_lote"],
    reporte: ["exportar"],
    cotizacion: ["descargar_pdf"],
    registro_cambios: ["exportar"]
  },
  configuracion: {
    campana: ["crear", "editar", "activar", "pausar", "finalizar"],
    catalogo_tipo_documento: ["cambiar_obligatorio"],
    evento_pendiente: ["reintentar"],
    proceso_fallido: ["cambiar_estado"]
  }
};

// Una baja hecha por una persona (desde la cola de clasificación, por
// ejemplo) sí es un "borrado", venga de la acción que venga; la que llega sola
// del link o de una queja la registra la automatización, sin usuario, y ya no
// entra por eso.
const condicionBajaManual = and(
  eq(auditoria.entidad, "prospecto"),
  sql`JSON_UNQUOTE(JSON_EXTRACT(${auditoria.despues}, '$.estado')) = 'baja'`
)!;

function condicionDe(tipo: TipoRegistro): SQL {
  const partes = Object.entries(REGLAS[tipo]).map(([entidad, acciones]) => and(eq(auditoria.entidad, entidad), inArray(auditoria.accion, acciones))!);
  if (tipo === "borrados") partes.push(condicionBajaManual);
  return or(...partes)!;
}

/** Condición SQL del filtro ("todo" = la suma de los cinco), siempre con una persona detrás. */
export function condicionRegistro(tipo: TipoRegistro | "todo"): SQL {
  const condicion = tipo === "todo" ? or(...TIPOS_REGISTRO.map(condicionDe))! : condicionDe(tipo);
  return and(isNotNull(auditoria.usuarioId), condicion)!;
}

/** En qué filtro cae una fila (para etiquetarla en la lista "Todo"). */
export function tipoDeFila(entidad: string, accion: string, despues: unknown): TipoRegistro | null {
  if (entidad === "prospecto" && (despues as { estado?: string } | null)?.estado === "baja") return "borrados";
  for (const tipo of TIPOS_REGISTRO) {
    if (REGLAS[tipo][entidad]?.includes(accion)) return tipo;
  }
  return null;
}
