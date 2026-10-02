import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { loginFallos, roles, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./passwords.js";
import { SessionService } from "./session.service.js";
import type { CurrentUser } from "./current-user.type.js";

// Freno por cuenta: 10 fallos en 15 minutos bloquean esa cuenta 15 minutos.
const MAX_FALLOS_POR_CUENTA = 10;
export const CODIGO_CUENTA_BLOQUEADA = "CUENTA_BLOQUEADA_TEMPORALMENTE";

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

  // Freno de login por cuenta (B1 del plan de fixes, 2-oct-2026): ver
  // 025_login_fallos.sql. Complementa al límite por IP (RateLimitGuard), que
  // vive en la memoria de cada instancia y se esquiva cambiando de IP o
  // esperando una instancia nueva. Corre igual para correos que no existen,
  // para no revelar cuáles son reales. Costo aceptado: quien conozca un
  // correo puede bloquearlo 15 minutos a propósito (por eso es temporal).
  async login(input: { correo: string; password: string }) {
    const [bloqueo] = await this.db
      .select({ segundos: sql<number>`TIMESTAMPDIFF(SECOND, CURRENT_TIMESTAMP, ${loginFallos.bloqueadoHasta})` })
      .from(loginFallos)
      .where(and(eq(loginFallos.correo, input.correo), sql`${loginFallos.bloqueadoHasta} > CURRENT_TIMESTAMP`))
      .limit(1);
    if (bloqueo) {
      throw new HttpError(429, "Demasiados intentos fallidos para esta cuenta; intenta de nuevo más tarde", CODIGO_CUENTA_BLOQUEADA, { "Retry-After": String(Math.max(1, Number(bloqueo.segundos))) });
    }

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
      await this.registrarFallo(input.correo);
      throw new HttpError(401, "Correo o contraseña incorrectos");
    }

    await this.db.delete(loginFallos).where(eq(loginFallos.correo, input.correo));
    const session = await this.sessionService.createSession(user.id);
    const currentUser: CurrentUser = { id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol as CurrentUser["rol"] };
    return { user: currentUser, session };
  }

  // Un solo UPDATE atómico por fila: si la ventana de 15 minutos ya pasó,
  // el conteo arranca de nuevo; al llegar a MAX_FALLOS_POR_CUENTA se bloquea
  // 15 minutos. MySQL evalúa las asignaciones de izquierda a derecha, así
  // que la tercera ya ve el `fallos` nuevo.
  private async registrarFallo(correo: string) {
    await this.db.insert(loginFallos).ignore().values({ correo });
    await this.db.update(loginFallos).set({
      fallos: sql`IF(${loginFallos.ventanaInicio} < CURRENT_TIMESTAMP - INTERVAL 15 MINUTE, 1, ${loginFallos.fallos} + 1)`,
      ventanaInicio: sql`IF(${loginFallos.ventanaInicio} < CURRENT_TIMESTAMP - INTERVAL 15 MINUTE, CURRENT_TIMESTAMP, ${loginFallos.ventanaInicio})`,
      bloqueadoHasta: sql`IF(${loginFallos.fallos} >= ${MAX_FALLOS_POR_CUENTA}, CURRENT_TIMESTAMP + INTERVAL 15 MINUTE, ${loginFallos.bloqueadoHasta})`
    }).where(eq(loginFallos.correo, correo));
  }
}
