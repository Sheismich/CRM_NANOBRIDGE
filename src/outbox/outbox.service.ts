import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, eventosPendientes, procesosFallidos } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import type { CurrentUser } from "../auth/current-user.type.js";

export type OutboxEventInput = {
  tipo: string;
  entidadTipo: string;
  entidadId: number;
  payload: Record<string, unknown>;
};

/**
 * Escribe eventos salientes en eventos_pendientes. Se usa siempre dentro de
 * la misma transacción que la acción que los dispara (cerrar tarea,
 * clasificar, reactivar) para que el patrón outbox sea real: si la
 * transacción falla, el evento tampoco se crea. OutboxDispatcherService lee
 * esta tabla por separado y entrega a n8n de forma asíncrona.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  /** tx: la transacción de Drizzle activa (o this.db si no hay una en curso). */
  async enqueue(tx: DrizzleTx, event: OutboxEventInput) {
    await tx.insert(eventosPendientes).values({
      eventoUuid: randomUUID(),
      tipo: event.tipo,
      entidadTipo: event.entidadTipo,
      entidadId: event.entidadId,
      payload: event.payload
    });
  }

  // "Los eventos fallidos son visibles y reintentables desde la pantalla de
  // eventos pendientes" (PLAN_CRM_DEFINITIVO.md #5).
  async list(estado: "pendiente" | "procesando" | "enviado" | "fallido" | undefined, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const condition = estado ? eq(eventosPendientes.estado, estado) : undefined;

    const rows = await this.db
      .select()
      .from(eventosPendientes)
      .where(condition)
      .orderBy(desc(eventosPendientes.creadoEn))
      .limit(limit)
      .offset(offset);

    return {
      page,
      limit,
      data: rows.map((row) => ({
        id: row.id,
        evento_uuid: row.eventoUuid,
        tipo: row.tipo,
        entidad_tipo: row.entidadTipo,
        entidad_id: row.entidadId,
        payload: row.payload,
        estado: row.estado,
        intentos: row.intentos,
        proximo_intento_en: row.proximoIntentoEn,
        ultimo_error: row.ultimoError,
        creado_en: row.creadoEn
      }))
    };
  }

  // Auditado (PLAN_API_DEFINITIVO.md, "Reglas técnicas obligatorias":
  // "reintentos manuales" es una de las cinco categorías que exige
  // auditoría explícitamente, junto con comercial/documentos/permisos/
  // supresiones -- hallazgo de la auditoría global del plan, 18-sep-2026).
  async retry(actor: CurrentUser, id: number) {
    await this.db.transaction(async (tx) => {
      const [event] = await tx.select().from(eventosPendientes).where(eq(eventosPendientes.id, id)).limit(1).for("update");
      if (!event) throw new HttpError(404, "Evento no encontrado");
      if (event.estado !== "fallido") throw new HttpError(409, "Solo se pueden reintentar eventos en estado fallido");

      await tx.update(eventosPendientes).set({
        estado: "pendiente",
        intentos: 0,
        proximoIntentoEn: null,
        ultimoError: null
      }).where(eq(eventosPendientes.id, id));

      await tx.insert(auditoria).values({
        usuarioId: actor.id,
        entidad: "evento_pendiente",
        entidadId: id,
        accion: "reintentar",
        antes: { estado: event.estado, intentos: event.intentos, ultimo_error: event.ultimoError },
        despues: { estado: "pendiente", intentos: 0 }
      });
    });
  }

  // "Revisión de procesos fallidos" (job/pantalla de PLAN_API_DEFINITIVO.md,
  // sección "Jobs internos"): hasta ahora procesos_fallidos solo se escribía
  // (outbox-dispatcher.service.ts al agotar reintentos, automatizacion.
  // service.ts registrarErrorWorkflow para fallos críticos de n8n) pero
  // nada lo exponía vía API para revisarlo -- hallazgo de la auditoría
  // global, 14-sep-2026.
  async listProcesosFallidos(estado: "abierto" | "en_revision" | "resuelto" | undefined, tipo: string | undefined, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const conditions = compactConditions([
      estado !== undefined ? eq(procesosFallidos.estado, estado) : undefined,
      tipo !== undefined ? eq(procesosFallidos.tipo, tipo) : undefined
    ]);

    const rows = await this.db
      .select()
      .from(procesosFallidos)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(procesosFallidos.creadoEn))
      .limit(limit)
      .offset(offset);

    return {
      page,
      limit,
      data: rows.map((row) => ({
        id: row.id,
        evento_id: row.eventoId,
        execution_id: row.executionId,
        workflow: row.workflow,
        nodo: row.nodo,
        endpoint: row.endpoint,
        codigo_http: row.codigoHttp,
        tipo: row.tipo,
        payload: row.payload,
        mensaje: row.mensaje,
        estado: row.estado,
        creado_en: row.creadoEn,
        actualizado_en: row.actualizadoEn
      }))
    };
  }

  // Solo cambia el estado del triage (abierto/en_revision/resuelto) -- a
  // diferencia de retry() de arriba, esto NO reintenta nada automáticamente
  // (un proceso_fallido puede no tener evento_id, ej. los que crea
  // registrarErrorWorkflow, así que no siempre hay algo que reintentar).
  // Auditado por el mismo motivo que retry() arriba: es la otra mitad de
  // "reintentos manuales" que PLAN_API_DEFINITIVO.md exige auditar.
  async actualizarEstadoProcesoFallido(actor: CurrentUser, id: number, estado: "abierto" | "en_revision" | "resuelto") {
    await this.db.transaction(async (tx) => {
      const [proceso] = await tx.select({ id: procesosFallidos.id, estado: procesosFallidos.estado }).from(procesosFallidos).where(eq(procesosFallidos.id, id)).limit(1).for("update");
      if (!proceso) throw new HttpError(404, "Proceso fallido no encontrado");

      await tx.update(procesosFallidos).set({ estado }).where(eq(procesosFallidos.id, id));

      await tx.insert(auditoria).values({
        usuarioId: actor.id,
        entidad: "proceso_fallido",
        entidadId: id,
        accion: "cambiar_estado",
        antes: { estado: proceso.estado },
        despues: { estado }
      });
    });
  }
}
