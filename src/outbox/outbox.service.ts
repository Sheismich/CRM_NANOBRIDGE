import { Inject, Injectable } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { eventosPendientes } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";

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

  async retry(id: number) {
    const [event] = await this.db.select().from(eventosPendientes).where(eq(eventosPendientes.id, id)).limit(1);
    if (!event) throw new HttpError(404, "Evento no encontrado");
    if (event.estado !== "fallido") throw new HttpError(409, "Solo se pueden reintentar eventos en estado fallido");

    await this.db.update(eventosPendientes).set({
      estado: "pendiente",
      intentos: 0,
      proximoIntentoEn: null,
      ultimoError: null
    }).where(eq(eventosPendientes.id, id));
  }
}
