import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { envios, eventosSendgrid, prospectos } from "../database/schema.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/http-error.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { normalizeEmail } from "../shared/normalize.js";
import { firmaSendgridValida } from "../shared/firma-sendgrid.js";
import { bloquearFreno, evaluarFreno } from "../shared/freno-dominio.js";
import { registrarSupresion } from "../shared/supresion.js";
import { darDeBajaPorEvento } from "../shared/supresion-por-evento.js";
import { marcarRebotado, rebotesSuavesSeguidos } from "../shared/rebotes.js";
import { corregirFallidoRecibido } from "../shared/envio-recibido.js";
import { EVENTOS_BAJA_DE_PERSONA } from "../automatizacion/dto/automatizacion.schema.js";
import { eventoSendgridSchema, loteSendgridSchema, type EventoSendgrid } from "./sendgrid-eventos.schema.js";

type Resultado = typeof eventosSendgrid.$inferInsert["resultado"];
type Clase = "duro" | "suave" | "baja_persona" | "otro";

function clasificar(ev: EventoSendgrid): Clase {
  if (ev.event === "bounce") return ev.type === "blocked" ? "suave" : "duro";
  if ((EVENTOS_BAJA_DE_PERSONA as readonly string[]).includes(ev.event)) return "baja_persona";
  return "otro";
}

function correoValido(email: string | undefined) {
  if (!email) return null;
  const correo = normalizeEmail(email);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ? correo : null;
}

function recortar(texto: string | undefined, max: number) {
  return texto ? texto.slice(0, max) : null;
}

/**
 * Event Webhook de SendGrid, directo a la API (044, 20-nov-2026; antes pasaba
 * por n8n PT3). Reglas:
 * - bounce tipo "bounce" (duro): se suprime ese correo y su prospecto pasa a
 *   rebotado. Solo ese prospecto: los demás de la persona no se tocan.
 * - bounce tipo "blocked" (suave): se cuenta; con
 *   REBOTES_SUAVES_PARA_DESACTIVAR seguidos (sin un "delivered" entre medio)
 *   el prospecto pasa a rebotado. El correo no se suprime: es temporal.
 * - spamreport / unsubscribe / group_unsubscribe: baja de la persona, igual
 *   que antes (shared/supresion-por-evento.ts).
 * - deferred, delivered, dropped y los demás: se guardan y no hacen nada.
 * - Un evento sin prospecto (respuestas de vendedores, cotizaciones, avisos
 *   del CRM) solo suprime el correo si es duro, y no cuenta para el freno.
 *
 * Cada evento va en su propia transacción y se guarda una sola vez por
 * sg_event_id (SendGrid puede repetirlos). Si uno truena, se responde 500 y
 * SendGrid reintenta el lote: los que ya entraron se saltan.
 */
@Injectable()
export class SendgridEventosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async recibir(cuerpo: Buffer | undefined, firma: string | undefined, timestamp: string | undefined, body: unknown) {
    if (!env.SENDGRID_WEBHOOK_PUBLIC_KEY) throw new HttpError(503, "El webhook de SendGrid no está configurado", "WEBHOOK_SIN_LLAVE");
    if (!cuerpo || !firmaSendgridValida(env.SENDGRID_WEBHOOK_PUBLIC_KEY, cuerpo, firma, timestamp)) {
      throw new HttpError(401, "Firma de SendGrid inválida", "FIRMA_INVALIDA");
    }

    const lote = loteSendgridSchema.parse(body);
    let procesados = 0;
    let repetidos = 0;
    let descartados = 0;
    for (const crudo of lote) {
      const leido = eventoSendgridSchema.safeParse(crudo);
      if (!leido.success) {
        descartados++;
        continue;
      }
      const nuevo = await this.procesar(leido.data);
      if (nuevo) procesados++;
      else repetidos++;
    }
    return { procesados, repetidos, descartados };
  }

  // Devuelve false si el evento ya se había procesado.
  async procesar(ev: EventoSendgrid): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const clase = clasificar(ev);
      const prospectoId = await this.prospectoDelEvento(tx, ev);
      const correo = correoValido(ev.email);
      const cuentaParaElFreno = prospectoId !== null && (clase === "duro" || clase === "suave" || ev.event === "spamreport");

      // El freno se bloquea ANTES de guardar el evento: dos eventos que
      // llegan juntos se forman desde aquí (ver bloquearFreno).
      if (cuentaParaElFreno) await bloquearFreno(tx);
      // El envío se bloquea ANTES de guardar el evento, igual que el "fallido"
      // de n8n (shared/envio-recibido.ts): así no se traban entre ellos.
      const envioId = prospectoId !== null ? ev.envio_id ?? null : null;
      if (envioId !== null) await tx.select({ id: envios.id }).from(envios).where(eq(envios.id, envioId)).for("update");

      let id: number;
      try {
        const [fila] = await tx.insert(eventosSendgrid).values({
          sgEventId: ev.sg_event_id,
          evento: ev.event,
          tipo: ev.event === "bounce" ? (ev.type === "blocked" ? "blocked" : "bounce") : recortar(ev.type, 20),
          motivo: recortar(ev.reason, 300),
          estadoSmtp: recortar(ev.status, 20),
          clasificacion: recortar(ev.bounce_classification, 60),
          correo: correo ?? recortar(ev.email, 512),
          prospectoId,
          envioId,
          ocurrioEn: new Date(ev.timestamp * 1000),
          resultado: "ignorado"
        });
        id = fila.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) return false;
        throw error;
      }

      // Un envío que n8n reportó fallido pero que SendGrid sí recibió (#4).
      if (envioId !== null) await corregirFallidoRecibido(tx, envioId, ev.event);

      const resultado = await this.aplicar(tx, ev, clase, prospectoId, correo);
      if (resultado !== "ignorado") await tx.update(eventosSendgrid).set({ resultado }).where(eq(eventosSendgrid.id, id));
      if (cuentaParaElFreno && resultado !== "ignorado") await evaluarFreno(tx);
      return true;
    });
  }

  private async aplicar(tx: DrizzleTx, ev: EventoSendgrid, clase: Clase, prospectoId: number | null, correo: string | null): Promise<Resultado> {
    const origen = { motivo: `Evento de SendGrid: ${ev.event}`.slice(0, 255), executionId: `sg:${ev.sg_event_id}`.slice(0, 100), usuarioId: null };

    if (clase === "duro") {
      if (correo) await registrarSupresion(tx, { tipo: "correo", valorNormalizado: correo, evento: "bounce", ...origen, motivo: `Rebote de SendGrid: ${ev.reason ?? "sin motivo"}`.slice(0, 255) });
      if (prospectoId === null) return correo ? "suprimido" : "ignorado";
      const cambio = await marcarRebotado(tx, prospectoId, { tipo: "duro", motivo: ev.reason ?? null, fecha: new Date(ev.timestamp * 1000) });
      return cambio ? "desactivado" : "suprimido";
    }

    if (clase === "suave") {
      if (prospectoId === null) return "ignorado";
      const seguidos = await rebotesSuavesSeguidos(tx, prospectoId);
      if (seguidos < env.REBOTES_SUAVES_PARA_DESACTIVAR) return "contado";
      const cambio = await marcarRebotado(tx, prospectoId, { tipo: "suave", motivo: ev.reason ?? null, fecha: new Date(ev.timestamp * 1000) });
      return cambio ? "desactivado" : "contado";
    }

    if (clase === "baja_persona") {
      if (!correo) return "ignorado";
      await registrarSupresion(tx, { tipo: "correo", valorNormalizado: correo, evento: ev.event, ...origen });
      await darDeBajaPorEvento(tx, "correo", correo, origen);
      return "baja_persona";
    }

    return "ignorado";
  }

  // El prospecto sale de los custom_args. Si viene envio_id y no es de ese
  // prospecto, no se le cree a ninguno de los dos.
  private async prospectoDelEvento(tx: DrizzleTx, ev: EventoSendgrid): Promise<number | null> {
    if (!ev.prospecto_id) return null;
    const [p] = await tx.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, ev.prospecto_id)).limit(1);
    if (!p) return null;
    if (ev.envio_id) {
      const [envio] = await tx.select({ prospectoId: envios.prospectoId }).from(envios).where(eq(envios.id, ev.envio_id)).limit(1);
      if (!envio || envio.prospectoId !== p.id) return null;
    }
    return p.id;
  }
}
