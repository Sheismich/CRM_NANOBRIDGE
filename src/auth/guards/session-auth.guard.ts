import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { and, eq, gt, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../../database/drizzle.constants.js";
import { roles, sesiones, usuarios } from "../../database/schema.js";
import { env } from "../../config/env.js";
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
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly sessionService: SessionService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { currentUser?: CurrentUser }>();
    const token = request.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
    if (!token) throw new HttpError(401, "Sesión requerida");

    const rows = await this.db
      .select({ id: usuarios.id, nombre: usuarios.nombre, correo: usuarios.correo, rol: roles.clave })
      .from(sesiones)
      .innerJoin(usuarios, eq(usuarios.id, sesiones.usuarioId))
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(and(eq(sesiones.id, this.sessionService.hashToken(token)), gt(sesiones.expiraEn, sql`CURRENT_TIMESTAMP`), eq(usuarios.activo, true)))
      .limit(1);

    if (rows.length !== 1) throw new HttpError(401, "Sesión no válida o expirada");
    request.currentUser = rows[0] as CurrentUser;
    return true;
  }
}
