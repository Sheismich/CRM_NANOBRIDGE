import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { eventosPendientes, procesosFallidos } from "../database/schema.js";
import { env } from "../config/env.js";

// Reintentos idempotentes: 3 intentos como máximo, con backoff 5s / 30s /
// 120s (PLAN_API_DEFINITIVO.md, PLAN_CRM_DEFINITIVO.md #5, MATRICES: "Tres
// intentos: 5 s, 30 s y 120 s").
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000];
const MAX_ATTEMPTS = RETRY_BACKOFF_MS.length;
const BATCH_SIZE = 20;

/**
 * Despachador del patrón outbox: entrega asíncronamente a n8n los eventos
 * que dejaron en eventos_pendientes el cierre de tareas, la clasificación y
 * las reactivaciones (ninguna pantalla llama a n8n directamente). Corre por
 * intervalo (jobs internos, PLAN_API_DEFINITIVO.md) y también se puede
 * disparar a mano vía POST /api/v1/eventos-pendientes/despachar.
 */
@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private dispatching = false;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Interval(env.OUTBOX_DISPATCH_INTERVAL_MS)
  async dispatchPending() {
    // Evita que dos corridas se pisen si una tanda tarda más que el
    // intervalo -- pero esto solo protege a ESTE proceso contra sí mismo.
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      // SELECT ... FOR UPDATE SKIP LOCKED + claim (marcar 'procesando') en
      // la misma transacción: sin esto, en un despliegue con más de una
      // instancia del backend, dos procesos podían leer y entregar el
      // mismo evento dos veces (mismo patrón que se corrigió en
      // listarVentanasVencidas -- hallazgo de code review, 10-sep-2026).
      const pending = await this.db.transaction(async (tx) => {
        const rows = await tx
          .select()
          .from(eventosPendientes)
          .where(and(
            eq(eventosPendientes.estado, "pendiente"),
            or(isNull(eventosPendientes.proximoIntentoEn), lte(eventosPendientes.proximoIntentoEn, sql`CURRENT_TIMESTAMP`))
          ))
          .limit(BATCH_SIZE)
          .for("update", { skipLocked: true });

        if (rows.length === 0) return [];

        await tx.update(eventosPendientes).set({ estado: "procesando" }).where(inArray(eventosPendientes.id, rows.map((row) => row.id)));
        return rows;
      });

      for (const event of pending) {
        await this.dispatchOne(event);
      }
      return pending.length;
    } finally {
      this.dispatching = false;
    }
  }

  // El evento ya quedó marcado 'procesando' (claim atómico en
  // dispatchPending); aquí solo se intenta la entrega.
  private async dispatchOne(event: typeof eventosPendientes.$inferSelect) {
    try {
      await this.deliver(event);
      await this.db.update(eventosPendientes).set({ estado: "enviado" }).where(eq(eventosPendientes.id, event.id));
    } catch (error) {
      await this.handleFailure(event, error);
    }
  }

  private async deliver(event: typeof eventosPendientes.$inferSelect) {
    if (!env.N8N_WEBHOOK_URL) {
      throw new Error("N8N_WEBHOOK_URL no está configurado");
    }

    const response = await fetch(env.N8N_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": env.WEBHOOK_ENTRADA_API_KEY },
      body: JSON.stringify({
        tipo: event.tipo,
        entidad_tipo: event.entidadTipo,
        entidad_id: event.entidadId,
        payload: event.payload
      })
    });

    if (!response.ok) {
      throw new Error(`n8n respondió ${response.status}`);
    }
  }

  private async handleFailure(event: typeof eventosPendientes.$inferSelect, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = event.intentos + 1;

    if (attempts >= MAX_ATTEMPTS) {
      await this.db.transaction(async (tx) => {
        await tx.update(eventosPendientes).set({
          estado: "fallido",
          intentos: attempts,
          ultimoError: message
        }).where(eq(eventosPendientes.id, event.id));

        await tx.insert(procesosFallidos).values({
          eventoId: event.id,
          tipo: event.tipo,
          payload: event.payload,
          error: message
        });
      });
      this.logger.error(`Evento ${event.id} (${event.tipo}) agotó reintentos: ${message}`);
      return;
    }

    const delayMs = RETRY_BACKOFF_MS[attempts - 1];
    await this.db.update(eventosPendientes).set({
      estado: "pendiente",
      intentos: attempts,
      ultimoError: message,
      proximoIntentoEn: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${delayMs / 1000} SECOND)`
    }).where(eq(eventosPendientes.id, event.id));
    this.logger.warn(`Evento ${event.id} (${event.tipo}) falló (intento ${attempts}/${MAX_ATTEMPTS}): ${message}`);
  }
}
