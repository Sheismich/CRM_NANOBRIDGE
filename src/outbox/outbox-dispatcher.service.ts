import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { eventosPendientes, procesosFallidos } from "../database/schema.js";
import { env } from "../config/env.js";

// Reintentos idempotentes con backoff 5s / 30s / 120s (PLAN_API_DEFINITIVO.md,
// PLAN_CRM_DEFINITIVO.md #5, MATRICES: "Tres intentos: 5 s, 30 s y 120 s"):
// 3 reintentos DESPUÉS del intento inicial (4 intentos en total), cada uno
// precedido por el backoff correspondiente -- RETRY_BACKOFF_MS.length ya
// no se usa como tope de intentos (ver handleFailure) porque eso dejaba
// el backoff de 120s como código muerto: con MAX_ATTEMPTS=3, el evento se
// marcaba 'fallido' definitivo justo al fallar el 3er intento, sin llegar
// nunca a esperar esos 120s (hallazgo de code review, 14-sep-2026).
const RETRY_BACKOFF_MS = [5_000, 30_000, 120_000];
const BATCH_SIZE = 20;
// Tope por envío a n8n: antes no había, y un n8n colgado trababa el lote.
const ENVIO_TIMEOUT_MS = 10_000;
// Cuánto dura el reclamo de un evento 'procesando' antes de que otra
// corrida lo pueda volver a tomar (B4, 2-oct-2026). Tiene que cubrir el PEOR
// lote completo (todos los envíos llegando a su tope) más margen para la
// base: con 120 s fijos, un lote de 20 x 10 s dejaba que otra instancia
// volviera a tomar eventos que la primera seguía enviando (code review de
// verificación, 5-oct-2026).
const RECLAMO_SEGUNDOS = (BATCH_SIZE * ENVIO_TIMEOUT_MS) / 1000 + 60;

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
  private avisoSinDestino = false;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Interval(env.OUTBOX_DISPATCH_INTERVAL_MS)
  async dispatchPending() {
    // Sin N8N_WEBHOOK_URL (B3 aún no existe en n8n) no hay a quién entregar:
    // no se reclama nada y los eventos esperan en 'pendiente' sin gastar
    // intentos. Antes cada uno agotaba sus 4 intentos y caía en
    // procesos_fallidos, y ese ruido escondía los errores reales de B4
    // (pendiente #3 de PLAN_N8N_DEFINITIVO.md, 7-oct-2026).
    if (!env.N8N_WEBHOOK_URL) {
      if (!this.avisoSinDestino) {
        this.avisoSinDestino = true;
        this.logger.warn("N8N_WEBHOOK_URL no está configurado: los eventos se quedan en 'pendiente' hasta que exista");
      }
      return 0;
    }

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
        // También toma los 'procesando' cuyo reclamo ya caducó: si la
        // instancia que los reclamó se apagó a medio envío (Cloud Run lo
        // hace solo), antes se quedaban atorados para siempre (B4 del plan
        // de fixes, 2-oct-2026). Si el envío sí había llegado a n8n, n8n lo
        // recibe otra vez y lo descarta por evento_uuid.
        const rows = await tx
          .select()
          .from(eventosPendientes)
          .where(or(
            and(
              eq(eventosPendientes.estado, "pendiente"),
              or(isNull(eventosPendientes.proximoIntentoEn), lte(eventosPendientes.proximoIntentoEn, sql`CURRENT_TIMESTAMP`))
            ),
            // NULL = reclamado por la versión de antes del Bloque B, que no
            // ponía vencimiento: sin esto se quedaban atorados para siempre.
            and(
              eq(eventosPendientes.estado, "procesando"),
              or(isNull(eventosPendientes.proximoIntentoEn), lte(eventosPendientes.proximoIntentoEn, sql`CURRENT_TIMESTAMP`))
            )
          ))
          .limit(BATCH_SIZE)
          .for("update", { skipLocked: true });

        if (rows.length === 0) return [];

        // El reclamo caduca en RECLAMO_SEGUNDOS: mientras tanto ninguna otra
        // corrida lo toma; si nadie lo cierra antes, vuelve a la fila.
        await tx.update(eventosPendientes).set({
          estado: "procesando",
          proximoIntentoEn: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${RECLAMO_SEGUNDOS} SECOND)`
        }).where(inArray(eventosPendientes.id, rows.map((row) => row.id)));
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
    } catch (error) {
      await this.handleFailure(event, error);
      return;
    }

    // La entrega YA se confirmó (deliver() no tronó, n8n respondió ok) --
    // si este UPDATE de bookkeeping falla, NO se trata como una falla de
    // entrega: handleFailure() reprogramaría un reintento y volvería a
    // mandar el mismo evento a n8n una segunda vez. deliver() ya manda
    // evento_uuid en el payload (020_eventos_pendientes_uuid.sql) para que
    // n8n pueda deduplicar ese reenvío del otro lado -- hallazgo de code
    // review, 14-sep-2026, cerrado con la columna UUID. Un fallo aquí sigue
    // siendo casi siempre un problema transitorio de la propia base (no de
    // n8n), así que solo se deja constancia para revisión manual en vez de
    // depender exclusivamente de la deduplicación de n8n.
    //
    // La entrega confirmada gana sobre un reintento que otra corrida dejó
    // 'pendiente' (así no se reenvía), pero no toca uno 'fallido': ese ya
    // está en procesos_fallidos para revisión manual.
    try {
      await this.db.update(eventosPendientes).set({ estado: "enviado" }).where(and(
        eq(eventosPendientes.id, event.id),
        inArray(eventosPendientes.estado, ["procesando", "pendiente"])
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Evento ${event.id} (${event.tipo}) se entregó a n8n pero no se pudo marcar 'enviado' en la base -- revisar manualmente para no reenviarlo: ${message}`);
    }
  }

  private async deliver(event: typeof eventosPendientes.$inferSelect) {
    if (!env.N8N_WEBHOOK_URL) {
      throw new Error("N8N_WEBHOOK_URL no está configurado");
    }

    const response = await fetch(env.N8N_WEBHOOK_URL, {
      method: "POST",
      signal: AbortSignal.timeout(ENVIO_TIMEOUT_MS),
      headers: { "Content-Type": "application/json", "X-API-Key": env.WEBHOOK_ENTRADA_API_KEY },
      body: JSON.stringify({
        evento_uuid: event.eventoUuid,
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
    // delayMs es el backoff a esperar antes del PRÓXIMO intento; undefined
    // cuando ya se usaron los 3 backoffs documentados (5s/30s/120s) y este
    // intento (el 4°) también falló -- ahí sí se agotan los reintentos.
    const delayMs = RETRY_BACKOFF_MS[attempts - 1];

    // Solo cuenta el fallo si el evento sigue como esta corrida lo reclamó:
    // 'procesando' y con el mismo número de intentos. Si otra corrida ya lo
    // envió, ya lo reintentó o ya lo dio por fallido, este fallo atrasado no
    // le pisa nada (antes lo regresaba a 'pendiente' y se reenviaba, o
    // creaba un procesos_fallidos falso -- code review, 5-oct-2026).
    const sigueSiendoMio = and(
      eq(eventosPendientes.id, event.id),
      eq(eventosPendientes.estado, "procesando"),
      eq(eventosPendientes.intentos, event.intentos)
    );

    if (delayMs === undefined) {
      const marcado = await this.db.transaction(async (tx) => {
        const [result] = await tx.update(eventosPendientes).set({
          estado: "fallido",
          intentos: attempts,
          ultimoError: message
        }).where(sigueSiendoMio);
        if (result.affectedRows === 0) return false;

        await tx.insert(procesosFallidos).values({
          eventoId: event.id,
          tipo: event.tipo,
          payload: event.payload,
          mensaje: message
        });
        return true;
      });
      if (!marcado) {
        this.logger.warn(`Evento ${event.id} (${event.tipo}) falló, pero otra corrida ya lo había resuelto: no se toca`);
        return;
      }
      this.logger.error(`Evento ${event.id} (${event.tipo}) agotó reintentos tras ${attempts} intentos: ${message}`);
      return;
    }

    const [result] = await this.db.update(eventosPendientes).set({
      estado: "pendiente",
      intentos: attempts,
      ultimoError: message,
      proximoIntentoEn: sql`DATE_ADD(CURRENT_TIMESTAMP, INTERVAL ${delayMs / 1000} SECOND)`
    }).where(sigueSiendoMio);
    if (result.affectedRows === 0) {
      this.logger.warn(`Evento ${event.id} (${event.tipo}) falló, pero otra corrida ya lo había resuelto: no se toca`);
      return;
    }
    this.logger.warn(`Evento ${event.id} (${event.tipo}) falló (intento ${attempts}), reintenta en ${delayMs / 1000}s: ${message}`);
  }
}
