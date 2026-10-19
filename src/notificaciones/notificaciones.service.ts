import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { notificaciones, usuarios } from "../database/schema.js";
import { env } from "../config/env.js";
import { HttpError } from "../shared/http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { CORREO_SERVICE, type CorreoService } from "../integraciones/correo.types.js";
import { armarCorreoAviso } from "./correo-aviso.js";

// Intentos de correo por aviso (el primero + 2 reintentos en días
// siguientes). Después se queda 'fallido' y solo cuenta la campanita.
const MAX_INTENTOS = 3;
const LOTE_REINTENTOS = 200;

@Injectable()
export class NotificacionesService {
  private readonly logger = new Logger(NotificacionesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(CORREO_SERVICE) private readonly correo: CorreoService
  ) {}

  // Lo más nuevo primero; solo los de la persona.
  async listar(user: CurrentUser, filtros: { soloNoLeidas: boolean; limit: number }) {
    const condiciones = [eq(notificaciones.usuarioId, user.id)];
    if (filtros.soloNoLeidas) condiciones.push(isNull(notificaciones.leidaEn));
    const filas = await this.db
      .select({ id: notificaciones.id, tipo: notificaciones.tipo, titulo: notificaciones.titulo, cuerpo: notificaciones.cuerpo, enlace: notificaciones.enlace, leidaEn: notificaciones.leidaEn, creadoEn: notificaciones.creadoEn })
      .from(notificaciones)
      .where(and(...condiciones))
      .orderBy(desc(notificaciones.id))
      .limit(filtros.limit);
    return {
      notificaciones: filas.map((f) => ({ id: f.id, tipo: f.tipo, titulo: f.titulo, cuerpo: f.cuerpo, enlace: f.enlace, leida: f.leidaEn !== null, creado_en: f.creadoEn })),
      no_leidas: await this.noLeidas(user)
    };
  }

  async noLeidas(user: CurrentUser) {
    const [fila] = await this.db.select({ total: count() }).from(notificaciones).where(and(eq(notificaciones.usuarioId, user.id), isNull(notificaciones.leidaEn)));
    return Number(fila?.total ?? 0);
  }

  // Marcarla dos veces no es error. La de otra persona, 404.
  async marcarLeida(user: CurrentUser, id: number) {
    const [propia] = await this.db.select({ id: notificaciones.id }).from(notificaciones).where(and(eq(notificaciones.id, id), eq(notificaciones.usuarioId, user.id))).limit(1);
    if (!propia) throw new HttpError(404, "Aviso no encontrado");
    await this.db.update(notificaciones).set({ leidaEn: sql`CURRENT_TIMESTAMP` }).where(and(eq(notificaciones.id, id), isNull(notificaciones.leidaEn)));
  }

  async leerTodas(user: CurrentUser) {
    const [result] = await this.db.update(notificaciones).set({ leidaEn: sql`CURRENT_TIMESTAMP` }).where(and(eq(notificaciones.usuarioId, user.id), isNull(notificaciones.leidaEn)));
    return { marcadas: result.affectedRows };
  }

  async preferencias(user: CurrentUser) {
    const [fila] = await this.db.select({ avisosPorCorreo: usuarios.avisosPorCorreo }).from(usuarios).where(eq(usuarios.id, user.id)).limit(1);
    return { avisos_por_correo: fila?.avisosPorCorreo ?? true };
  }

  async cambiarPreferencias(user: CurrentUser, input: { avisos_por_correo: boolean }) {
    await this.db.update(usuarios).set({ avisosPorCorreo: input.avisos_por_correo }).where(eq(usuarios.id, user.id));
    return this.preferencias(user);
  }

  // Manda los correos de estos avisos (los que dejó una petición). Nunca
  // lanza: si SendGrid falla, el aviso queda 'fallido' para el reintento.
  async enviarCorreos(ids: readonly number[]) {
    let enviados = 0;
    for (const id of ids) if (await this.enviarUno(id)) enviados++;
    return enviados;
  }

  // Trabajo diario (va dentro de sla-tareas para no tocar PT5): los
  // fallidos, y los pendientes de más de 5 minutos (la petición que los
  // creó no alcanzó a mandarlos).
  async reintentarCorreos() {
    const filas = await this.db
      .select({ id: notificaciones.id })
      .from(notificaciones)
      .where(and(
        lt(notificaciones.correoIntentos, MAX_INTENTOS),
        or(
          eq(notificaciones.correoEstado, "fallido"),
          and(eq(notificaciones.correoEstado, "pendiente"), lt(notificaciones.creadoEn, sql`CURRENT_TIMESTAMP - INTERVAL 5 MINUTE`))
        )
      ))
      .orderBy(notificaciones.id)
      .limit(LOTE_REINTENTOS);
    return this.enviarCorreos(filas.map((f) => f.id));
  }

  private async enviarUno(id: number) {
    const [fila] = await this.db
      .select({
        intentos: notificaciones.correoIntentos,
        titulo: notificaciones.titulo,
        cuerpo: notificaciones.cuerpo,
        enlace: notificaciones.enlace,
        correo: usuarios.correo,
        nombre: usuarios.nombre,
        activo: usuarios.activo,
        avisosPorCorreo: usuarios.avisosPorCorreo
      })
      .from(notificaciones)
      .innerJoin(usuarios, eq(usuarios.id, notificaciones.usuarioId))
      .where(and(eq(notificaciones.id, id), inArray(notificaciones.correoEstado, ["pendiente", "fallido"]), lt(notificaciones.correoIntentos, MAX_INTENTOS)))
      .limit(1);
    if (!fila) return false;

    // Apagó sus correos (o se fue) entre el aviso y el envío.
    if (!fila.activo || !fila.avisosPorCorreo) {
      await this.db.update(notificaciones).set({ correoEstado: "no_aplica" }).where(eq(notificaciones.id, id));
      return false;
    }

    // Se aparta sumando el intento solo si nadie más lo apartó: el
    // reintento y la petición que lo creó no mandan el mismo correo dos veces.
    const [apartado] = await this.db.update(notificaciones).set({ correoIntentos: fila.intentos + 1 })
      .where(and(eq(notificaciones.id, id), eq(notificaciones.correoIntentos, fila.intentos), inArray(notificaciones.correoEstado, ["pendiente", "fallido"])));
    if (apartado.affectedRows === 0) return false;

    try {
      const url = `${env.CRM_URL}${fila.enlace ?? "/"}`;
      await this.correo.enviar({ para: fila.correo, nombrePara: fila.nombre, categoria: "aviso_crm", ...armarCorreoAviso({ nombre: fila.nombre, titulo: fila.titulo, cuerpo: fila.cuerpo, url }) });
      await this.db.update(notificaciones).set({ correoEstado: "enviado", correoError: null, correoEnviadoEn: sql`CURRENT_TIMESTAMP` }).where(eq(notificaciones.id, id));
      return true;
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      this.logger.warn(`No salió el correo del aviso ${id}: ${mensaje}`);
      await this.db.update(notificaciones).set({ correoEstado: "fallido", correoError: mensaje.slice(0, 500) }).where(eq(notificaciones.id, id));
      return false;
    }
  }
}
