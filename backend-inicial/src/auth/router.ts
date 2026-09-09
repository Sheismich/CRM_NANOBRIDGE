import { Router } from "express";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import { z } from "zod";
import { pool } from "../database/pool.js";
import { HttpError } from "../shared/http.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { requireUser } from "./require-user.js";
import { clearSessionCookie, createSession, deleteSession, setSessionCookie } from "./session.js";
import { env } from "../config/env.js";

export const authRouter = Router();
const credentials = z.object({ correo: z.string().trim().email().max(254).transform((value) => value.toLowerCase()), password: z.string().min(12).max(128) });

authRouter.post("/bootstrap", async (request, response, next) => {
  try {
    const input = credentials.extend({ nombre: z.string().trim().min(2).max(160) }).parse(request.body);
    const [users] = await pool.query<RowDataPacket[]>("SELECT COUNT(*) AS total FROM usuarios");
    if (Number(users[0].total) > 0) throw new HttpError(409, "La cuenta inicial ya fue creada");
    const [roles] = await pool.query<RowDataPacket[]>("SELECT id FROM roles WHERE clave = 'administrador'");
    const passwordHash = await hashPassword(input.password);
    const [result] = await pool.query<ResultSetHeader>("INSERT INTO usuarios (rol_id, nombre, correo, password_hash) VALUES (?, ?, ?, ?)", [roles[0].id, input.nombre, input.correo, passwordHash]);
    const session = await createSession(result.insertId);
    setSessionCookie(response, session.token, session.expiresAt);
    response.status(201).json({ id: result.insertId, nombre: input.nombre, correo: input.correo, rol: "administrador" });
  } catch (error) { next(error); }
});

authRouter.post("/login", async (request, response, next) => {
  try {
    const input = credentials.parse(request.body);
    const [users] = await pool.query<RowDataPacket[]>(`SELECT u.id, u.nombre, u.correo, u.password_hash, u.activo, r.clave AS rol
      FROM usuarios u JOIN roles r ON r.id = u.rol_id WHERE u.correo = ?`, [input.correo]);
    const user = users[0];
    if (!user || !user.activo || user.rol === "sistema" || !(await verifyPassword(user.password_hash, input.password))) {
      throw new HttpError(401, "Correo o contraseña incorrectos");
    }
    const session = await createSession(user.id);
    setSessionCookie(response, session.token, session.expiresAt);
    response.json({ id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol });
  } catch (error) { next(error); }
});

authRouter.post("/logout", async (request, response, next) => {
  try {
    await deleteSession(request.cookies[env.SESSION_COOKIE_NAME] as string | undefined);
    clearSessionCookie(response);
    response.status(204).send();
  } catch (error) { next(error); }
});

authRouter.get("/me", requireUser, (request, response) => response.json(request.currentUser));
