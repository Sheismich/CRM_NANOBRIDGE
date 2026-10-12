import { CanActivate, ExecutionContext, Inject, Injectable, Logger } from "@nestjs/common";
import type { Request } from "express";
import { and, eq, gt, ne, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../../database/drizzle.constants.js";
import { roles, sesiones, usuarios } from "../../database/schema.js";
import { HttpError } from "../../shared/http-error.js";
import { SessionService } from "../session.service.js";
import type { CurrentUser } from "../current-user.type.js";

/**
 * Reemplaza al middleware requireUser de Express y a la función
 * requireUser(request) de la versión en Next.js: valida la cookie de
 * sesión y deja al usuario actual en request.currentUser para que el
 * decorador @CurrentUser() lo entregue en los controladores.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly sessionService: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { currentUser?: CurrentUser }>();
    const token = this.sessionService.tokenDeLaPeticion(request);
    if (!token) throw new HttpError(401, "Sesión requerida");

    const rows = await this.db
      .select({ id: usuarios.id, nombre: usuarios.nombre, correo: usuarios.correo, rol: roles.clave, ultimoAccesoEn: usuarios.ultimoAccesoEn })
      .from(sesiones)
      .innerJoin(usuarios, eq(usuarios.id, sesiones.usuarioId))
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      // ne(roles.clave, "sistema") agregado (hallazgo de code review,
      // 14-sep-2026): login() ya rechaza autenticar como 'sistema'
      // (auth.service.ts) porque ese rol es para llamadas automatizadas
      // vía ApiKeyGuard, no para sesiones de usuario -- pero este guard no
      // repetía esa misma regla, así que una fila 'sistema' con una
      // sesión (creada por cualquier vía futura) igual pasaba por aquí.
      .where(and(eq(sesiones.id, this.sessionService.hashToken(token)), gt(sesiones.expiraEn, sql`CURRENT_TIMESTAMP`), eq(usuarios.activo, true), ne(roles.clave, "sistema")))
      .limit(1);

    if (rows.length !== 1) throw new HttpError(401, "Sesión no válida o expirada");
    const { ultimoAccesoEn, ...usuario } = rows[0]!;
    if (!ultimoAccesoEn || Date.now() - ultimoAccesoEn.getTime() > CADA_CUANTO_ULTIMO_ACCESO_MS) {
      await this.marcarUltimoAcceso(usuario.id);
    }
    request.currentUser = usuario as CurrentUser;
    return true;
  }

  // "Último acceso" de Administración (12-oct-2026): a lo más una vez cada 5
  // minutos por usuario, no en cada petición. La condición va repetida en el
  // UPDATE para que dos peticiones al mismo tiempo no escriban las dos. Si
  // falla, solo se anota: no vale tumbar la petición por esto.
  private async marcarUltimoAcceso(usuarioId: number) {
    try {
      await this.db.update(usuarios)
        .set({ ultimoAccesoEn: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(usuarios.id, usuarioId), sql`(${usuarios.ultimoAccesoEn} IS NULL OR ${usuarios.ultimoAccesoEn} < CURRENT_TIMESTAMP - INTERVAL 5 MINUTE)`));
    } catch (error) {
      this.logger.warn(`No se pudo guardar el último acceso del usuario ${usuarioId}: ${(error as Error).message}`);
    }
  }
}

const CADA_CUANTO_ULTIMO_ACCESO_MS = 5 * 60_000;
