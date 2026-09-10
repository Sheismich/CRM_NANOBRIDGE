import type { MySql2Database } from "drizzle-orm/mysql2";
import type * as schema from "./schema.js";

/** Token de inyección para pedir la instancia de Drizzle con @Inject(DRIZZLE). */
export const DRIZZLE = Symbol("DRIZZLE_CONNECTION");

export type DrizzleDb = MySql2Database<typeof schema>;

/**
 * Tipo del `tx` que recibe el callback de `db.transaction(async (tx) => ...)`.
 * No es lo mismo que DrizzleDb (Drizzle usa una clase distinta para
 * transacciones, MySqlTransaction), pero soporta el mismo `.select()` /
 * `.insert()` / `.update()`; se usa para tipar helpers (como OutboxService)
 * que reciben una transacción ya abierta desde otro servicio.
 */
export type DrizzleTx = Parameters<DrizzleDb["transaction"]>[0] extends (tx: infer T, ...rest: never[]) => unknown ? T : never;
