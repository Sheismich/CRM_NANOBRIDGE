import { createHash, randomBytes } from "node:crypto";
import type { Response } from "express";
import { env } from "../config/env.js";
import { pool } from "../database/pool.js";

function sessionHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(usuarioId: number) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  await pool.query("INSERT INTO sesiones (id, usuario_id, expira_en) VALUES (?, ?, ?)", [sessionHash(token), usuarioId, expiresAt]);
  return { token, expiresAt };
}

export function setSessionCookie(response: Response, token: string, expiresAt: Date) {
  response.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/"
  });
}

export async function deleteSession(token: string | undefined) {
  if (token) await pool.query("DELETE FROM sesiones WHERE id = ?", [sessionHash(token)]);
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(env.SESSION_COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" });
}

export { sessionHash };
