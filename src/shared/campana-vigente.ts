import { sql } from "drizzle-orm";
import { campanas } from "../database/schema.js";

// ¿Esta campaña manda correos hoy? Una sola regla para los tres lugares que
// lo preguntan: "Campaña activa" (PT1), /envios/vencidas (PT4) y la lista
// de campañas del CRM. Antes cada uno lo calculaba a su modo y ninguno
// revisaba fecha_inicio: una campaña "activa" con inicio futuro ya mandaba
// (hallazgo del 1-oct-2026).
//
// - activa: estado activa, ya empezó y no ha terminado.
// - en_espera: pausada, o activa con fecha_inicio futura. No manda, pero
//   nada se cancela: sus recordatorios esperan y PT1 no cierra a sus
//   prospectos (decisión de Fabián, 1-oct-2026: pausa = espera).
// - inactiva: finalizada, borrador o ya pasó su fecha_fin. No manda y sus
//   recordatorios se cancelan.
//
// `hoy` es la fecha en México (fechaMx, shared/dia-habil.ts), no
// CURDATE(): la conexión corre en UTC y CURDATE() cambia de día a las 6 pm
// de México, así que una campaña que empieza el 6 empezaba a mandar el 5 en
// la tarde y una que termina el 10 dejaba de mandar el 10 en la tarde.
export type VigenciaCampana = "activa" | "en_espera" | "inactiva";
export type MotivoCampanaSinEnviar = "pausada" | "aun_no_empieza" | "finalizada" | "vencida" | "borrador";

export function campanaYaEmpezoSql(hoy: string) {
  return sql<number>`(${campanas.fechaInicio} IS NULL OR ${campanas.fechaInicio} <= ${hoy})`;
}

export function campanaNoHaTerminadoSql(hoy: string) {
  return sql<number>`(${campanas.fechaFin} IS NULL OR ${campanas.fechaFin} >= ${hoy})`;
}

// Predicado SQL de "en espera", para filtrar dentro de una consulta (ver
// listarVentanasVencidas). Debe coincidir con vigenciaCampana().
export function campanaEnEsperaSql(hoy: string) {
  return sql`((${campanas.estado} = 'pausada' OR (${campanas.estado} = 'activa' AND NOT ${campanaYaEmpezoSql(hoy)})) AND ${campanaNoHaTerminadoSql(hoy)})`;
}

type EstadoCampana = typeof campanas.$inferSelect["estado"];

// MySQL devuelve las comparaciones como 0/1 (a veces como texto).
export function vigenciaCampana(estado: EstadoCampana, yaEmpezo: number | string | boolean | null, noHaTerminado: number | string | boolean | null): { vigencia: VigenciaCampana; motivo: MotivoCampanaSinEnviar | null } {
  if (estado === "finalizada") return { vigencia: "inactiva", motivo: "finalizada" };
  if (estado === "borrador") return { vigencia: "inactiva", motivo: "borrador" };
  if (!Number(noHaTerminado)) return { vigencia: "inactiva", motivo: "vencida" };
  if (estado === "pausada") return { vigencia: "en_espera", motivo: "pausada" };
  if (!Number(yaEmpezo)) return { vigencia: "en_espera", motivo: "aun_no_empieza" };
  return { vigencia: "activa", motivo: null };
}
