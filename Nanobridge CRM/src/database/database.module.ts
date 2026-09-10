import { Global, Module } from "@nestjs/common";
import { drizzle } from "drizzle-orm/mysql2";
import { pool } from "./pool.js";
import * as schema from "./schema.js";
import { DRIZZLE } from "./drizzle.constants.js";

/**
 * Envuelve el mismo pool de mysql2 de siempre (src/database/pool.ts) con el
 * query builder tipado de Drizzle, y lo expone como provider inyectable en
 * cualquier módulo con @Inject(DRIZZLE). @Global() evita tener que importar
 * DatabaseModule en cada módulo de features (patrón normal en Nest para la
 * conexión a base de datos).
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE,
      useValue: drizzle(pool, { schema, mode: "default" })
    }
  ],
  exports: [DRIZZLE]
})
export class DatabaseModule {}
