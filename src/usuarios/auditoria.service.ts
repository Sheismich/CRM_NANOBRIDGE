import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria } from "../database/schema.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import type { ListarAuditoriaQuery } from "./dto/auditoria.schema.js";

// Módulo de solo lectura: auditoria es un log de solo-inserción que
// escriben el resto de los servicios (empresas, usuarios, tareas, etc.) --
// aquí no hay create/update/delete, solo list().

@Injectable()
export class AuditoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(query: ListarAuditoriaQuery) {
    const offset = (query.page - 1) * query.limit;
    const conditions = compactConditions([
      query.entidad !== undefined ? eq(auditoria.entidad, query.entidad) : undefined,
      query.entidad_id !== undefined ? eq(auditoria.entidadId, query.entidad_id) : undefined,
      query.usuario_id !== undefined ? eq(auditoria.usuarioId, query.usuario_id) : undefined,
      query.accion !== undefined ? eq(auditoria.accion, query.accion) : undefined,
      query.desde !== undefined ? gte(auditoria.creadoEn, new Date(query.desde)) : undefined,
      query.hasta !== undefined ? lte(auditoria.creadoEn, new Date(query.hasta)) : undefined
    ]);

    const rows = await this.db
      .select({
        id: auditoria.id,
        usuario_id: auditoria.usuarioId,
        entidad: auditoria.entidad,
        entidad_id: auditoria.entidadId,
        accion: auditoria.accion,
        antes: auditoria.antes,
        despues: auditoria.despues,
        creado_en: auditoria.creadoEn
      })
      .from(auditoria)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      // Log, no lista: lo más reciente primero (a diferencia de list() en
      // el resto del CRM, que ordena por nombre/id ascendente).
      .orderBy(desc(auditoria.id))
      .limit(query.limit)
      .offset(offset);

    return { page: query.page, limit: query.limit, data: rows };
  }
}
