import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { roles, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./passwords.js";
import { SessionService } from "./session.service.js";
import type { CurrentUser } from "./current-user.type.js";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly sessionService: SessionService
  ) {}

  async bootstrap(input: { nombre: string; correo: string; password: string }) {
    const passwordHash = await hashPassword(input.password);

    const userId = await this.db.transaction(async (tx) => {
      // La fila del rol 'administrador' (siempre existe desde la migración
      // inicial) se usa como mutex vía FOR UPDATE: un SELECT COUNT(*)
      // FOR UPDATE sobre "usuarios" no serviría porque una tabla vacía no
      // tiene filas que bloquear, así que dos POST /auth/bootstrap
      // concurrentes podían leer total=0 antes de que cualquiera
      // confirmara su insert (hallazgo de code review, 10-sep-2026).
      const [adminRole] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.clave, "administrador")).limit(1).for("update");
      if (!adminRole) throw new HttpError(500, "Rol 'administrador' no encontrado (¿se corrieron las migraciones?)");

      const [{ total }] = await tx.select({ total: count() }).from(usuarios);
      if (total > 0) throw new HttpError(409, "La cuenta inicial ya fue creada");

      try {
        const [result] = await tx.insert(usuarios).values({ rolId: adminRole.id, nombre: input.nombre, correo: input.correo, passwordHash });
        return result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) throw new HttpError(409, "La cuenta inicial ya fue creada");
        throw error;
      }
    });

    const session = await this.sessionService.createSession(userId);
    const user: CurrentUser = { id: userId, nombre: input.nombre, correo: input.correo, rol: "administrador" };
    return { user, session };
  }

  async login(input: { correo: string; password: string }) {
    const [user] = await this.db
      .select({ id: usuarios.id, nombre: usuarios.nombre, correo: usuarios.correo, passwordHash: usuarios.passwordHash, activo: usuarios.activo, rol: roles.clave })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(eq(usuarios.correo, input.correo))
      .limit(1);

    // Siempre corre argon2.verify(), exista o no el usuario (contra
    // DUMMY_PASSWORD_HASH si no existe): cortar camino antes de verificar
    // dejaba una respuesta mucho más rápida para correos inexistentes que
    // para correos reales, filtrando por temporización qué correos tienen
    // cuenta (hallazgo de code review, 10-sep-2026).
    const passwordValida = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, input.password);

    if (!user || !user.activo || user.rol === "sistema" || !passwordValida) {
      throw new HttpError(401, "Correo o contraseña incorrectos");
    }

    const session = await this.sessionService.createSession(user.id);
    const currentUser: CurrentUser = { id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol as CurrentUser["rol"] };
    return { user: currentUser, session };
  }
}
