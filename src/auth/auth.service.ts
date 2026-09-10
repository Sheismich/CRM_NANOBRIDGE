import { Inject, Injectable } from "@nestjs/common";
import { count, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { roles, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { SessionService } from "./session.service.js";
import type { CurrentUser } from "./current-user.type.js";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly sessionService: SessionService
  ) {}

  async bootstrap(input: { nombre: string; correo: string; password: string }) {
    const [{ total }] = await this.db.select({ total: count() }).from(usuarios);
    if (total > 0) throw new HttpError(409, "La cuenta inicial ya fue creada");

    const [adminRole] = await this.db.select({ id: roles.id }).from(roles).where(eq(roles.clave, "administrador")).limit(1);
    const passwordHash = await hashPassword(input.password);
    const [result] = await this.db.insert(usuarios).values({ rolId: adminRole.id, nombre: input.nombre, correo: input.correo, passwordHash });

    const session = await this.sessionService.createSession(result.insertId);
    const user: CurrentUser = { id: result.insertId, nombre: input.nombre, correo: input.correo, rol: "administrador" };
    return { user, session };
  }

  async login(input: { correo: string; password: string }) {
    const [user] = await this.db
      .select({ id: usuarios.id, nombre: usuarios.nombre, correo: usuarios.correo, passwordHash: usuarios.passwordHash, activo: usuarios.activo, rol: roles.clave })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(eq(usuarios.correo, input.correo))
      .limit(1);

    if (!user || !user.activo || user.rol === "sistema" || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new HttpError(401, "Correo o contraseña incorrectos");
    }

    const session = await this.sessionService.createSession(user.id);
    const currentUser: CurrentUser = { id: user.id, nombre: user.nombre, correo: user.correo, rol: user.rol as CurrentUser["rol"] };
    return { user: currentUser, session };
  }
}
