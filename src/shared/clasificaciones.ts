// Las clasificaciones de una respuesta, en un solo lugar: de aquí salen el
// ENUM de Drizzle (schema.ts) y los z.enum de los endpoints. Antes la lista
// estaba escrita a mano en tres archivos y ya se había desfasado una vez.
// El SQL de las migraciones por fuerza va escrito a mano; un test
// (180-clasificacion-respuestas.spec.ts) compara el ENUM real de la base
// contra esta constante.
//
// Archivo sin imports a propósito: schema.ts lo importa, y
// clasificacion-respuesta.ts importa schema.ts; tenerlo ahí armaba un ciclo
// de módulos donde la constante podía leerse antes de existir.
//
// El orden importa: es el del ENUM en la base, y los valores nuevos van al
// final (MySQL 8 lo aplica como cambio de metadatos, sin reescribir la
// tabla; ver 022_clasificacion_manual.sql).
export const CLASIFICACIONES_RESPUESTA = ["interesado", "no_interesado", "baja", "automatica", "ambigua", "invalido", "reagendar"] as const;
export type ClasificacionRespuesta = (typeof CLASIFICACIONES_RESPUESTA)[number];

// `code` del 409 cuando alguien (una persona, n8n o la sugerencia de la IA)
// llega a una respuesta que otro ya clasificó. La pantalla de la cola
// compara contra esto, no contra el texto del mensaje.
export const CODIGO_RESPUESTA_YA_CLASIFICADA = "RESPUESTA_YA_CLASIFICADA";

// Lo que puede decidir n8n (POST /automatizacion/respuestas/clasificacion).
export const CLASIFICACIONES_N8N = ["interesado", "no_interesado", "baja", "automatica", "ambigua"] as const satisfies readonly ClasificacionRespuesta[];

// Lo que puede decidir una persona en la cola de clasificación: sin
// "automatica" ni "ambigua" (la cola existe justo para resolver una
// ambigua), con "invalido" y "reagendar", que solo existen aquí.
export const CLASIFICACIONES_MANUALES = ["interesado", "no_interesado", "baja", "invalido", "reagendar"] as const satisfies readonly ClasificacionRespuesta[];
