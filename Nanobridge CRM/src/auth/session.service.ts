import { createHash, randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { Response } from "express";
import { eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { sesiones } from "../database/schema.js";
import { env } from "../config/env.js";

@Injectable()
export class SessionService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  hashToken(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  async createSession(usuarioId: number) {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
    await this.db.insert(sesiones).values({ id: this.hashToken(token), usuarioId, expiraEn: expiresAt });
    return { token, expiresAt };
  }

  async deleteSession(token: string | undefined) {
    if (token) await this.db.delete(sesiones).where(eq(sesiones.id, this.hashToken(token)));
  }

  setSessionCookie(response: Response, token: string, expiresAt: Date) {
    response.cookie(env.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      expires: expiresAt,
      path: "/"
    });
  }

  clearSessionCookie(response: Response) {
    response.clearCookie(env.SESSION_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  }
}
