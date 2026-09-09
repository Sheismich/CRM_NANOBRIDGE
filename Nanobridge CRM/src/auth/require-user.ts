import type { NextFunction, Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { env } from "../config/env.js";
import { pool } from "../database/pool.js";
import { HttpError } from "../shared/http.js";
import { sessionHash } from "./session.js";

export type CurrentUser = { id: number; nombre: string; correo: string; rol: "administrador" | "supervisor" | "agente" | "sistema" };

declare global {
  namespace Express {
    interface Request { currentUser?: CurrentUser }
  }
}

export async function requireUser(request: Request, _response: Response, next: NextFunction) {
  try {
    const token = request.cookies[env.SESSION_COOKIE_NAME] as string | undefined;
    if (!token) throw new HttpError(401, "Sesión requerida");
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT u.id, u.nombre, u.correo, r.clave AS rol
      FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id JOIN roles r ON r.id = u.rol_id
      WHERE s.id = ? AND s.expira_en > CURRENT_TIMESTAMP AND u.activo = TRUE`, [sessionHash(token)]);
    if (rows.length !== 1) throw new HttpError(401, "Sesión no válida o expirada");
    request.currentUser = rows[0] as CurrentUser;
    next();
  } catch (error) { next(error); }
}

export function requireRole(...roles: CurrentUser["rol"][]) {
  return (request: Request, _response: Response, next: NextFunction) => {
    if (!request.currentUser || !roles.includes(request.currentUser.rol)) return next(new HttpError(403, "No tienes permiso para esta acción"));
    next();
  };
}
