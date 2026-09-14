import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, ne } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, roles, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { buildAntes, compactConditions } from "../shared/drizzle-utils.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { hashPassword } from "../auth/passwords.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { ActualizarUsuarioInput, CrearUsuarioInput, ListarUsuariosQuery } from "./dto/usuario.schema.js";

// passwordHash NUNCA se selecciona aquí: ni en list()/get() (columnas
// explícitas, como EmpresasService), ni en los payloads de auditoría de
// create()/update() (que registran "rol"/"actualizada", nunca el hash ni
// la contraseña en claro). Solo aparece del lado derecho de un
// .values()/.set() al escribir.

@Injectable()
export class UsuariosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(query: ListarUsuariosQuery) {
    const offset = (query.page - 1) * query.limit;
    const conditions = compactConditions([
      query.rol !== undefined ? eq(roles.clave, query.rol) : undefined,
      query.activo !== undefined ? eq(usuarios.activo, query.activo) : undefined
    ]);

    const rows = await this.db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        correo: usuarios.correo,
        rol: roles.clave,
        activo: usuarios.activo,
        creado_en: usuarios.creadoEn,
        actualizado_en: usuarios.actualizadoEn
      })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(usuarios.id)
      .limit(query.limit)
      .offset(offset);

    return { page: query.page, limit: query.limit, data: rows };
  }

  // A propósito NO filtra por activo=true (a diferencia de
  // EmpresasService.get()/findEmpresaScoped()): list() ya deja consultar
  // cuentas desactivadas vía ?activo=false para revisión administrativa
  // (quién tenía acceso, cuándo se desactivó -- cruzable con /auditoria),
  // así que ocultar aquí la misma cuenta que list() sí puede mostrar sería
  // una inconsistencia peor que la que evita (hallazgo de code review,
  // 14-sep-2026: se dejó explícito para que no se lea como un descuido).
  async get(id: number) {
    const [user] = await this.db
      .select({
        id: usuarios.id,
        nombre: usuarios.nombre,
        correo: usuarios.correo,
        rol: roles.clave,
        activo: usuarios.activo,
        creado_en: usuarios.creadoEn,
        actualizado_en: usuarios.actualizadoEn
      })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(eq(usuarios.id, id))
      .limit(1);

    if (!user) throw new HttpError(404, "Usuario no encontrado");
    return user;
  }

  async create(actor: CurrentUser, input: CrearUsuarioInput) {
    // argon2id fuera de la transacción (hallazgo de code review,
    // 14-sep-2026, mismo motivo que bootstrap() en auth.service.ts): es
    // CPU-bound y tarda decenas/cientos de ms -- calcularlo mientras se
    // tiene una conexión del pool abierta (y, en update(), una fila
    // bloqueada con FOR UPDATE) alarga esa ventana sin necesidad.
    const passwordHash = await hashPassword(input.password);

    return this.db.transaction(async (tx) => {
      // Mismo patrón que bootstrap() en auth.service.ts: el rol se busca
      // por clave, nunca se asume un id fijo.
      const [rol] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.clave, input.rol)).limit(1);
      if (!rol) throw new HttpError(500, `Rol '${input.rol}' no encontrado (¿se corrieron las migraciones?)`);

      let insertId: number;
      try {
        const [result] = await tx.insert(usuarios).values({ rolId: rol.id, nombre: input.nombre, correo: input.correo, passwordHash });
        insertId = result.insertId;
      } catch (error) {
        if (isDuplicateEntry(error)) throw new HttpError(409, "Ya existe un usuario con ese correo");
        throw error;
      }

      // despues nunca incluye password ni passwordHash -- solo los campos
      // legibles, igual que el resto de este módulo.
      await tx.insert(auditoria).values({
        usuarioId: actor.id,
        entidad: "usuario",
        entidadId: insertId,
        accion: "crear",
        despues: { nombre: input.nombre, correo: input.correo, rol: input.rol }
      });

      return insertId;
    });
  }

  async update(actor: CurrentUser, id: number, input: ActualizarUsuarioInput) {
    // argon2id fuera de la transacción -- mismo motivo que en create().
    const nuevoPasswordHash = input.password !== undefined ? await hashPassword(input.password) : undefined;

    await this.db.transaction(async (tx) => {
      // Orden fijo de locks (hallazgo de code review, 14-sep-2026): SIEMPRE
      // se bloquea primero la fila compartida roles('administrador'),
      // antes de bloquear la fila usuarios objetivo de abajo. Sin este
      // orden fijo, dos llamadas concurrentes a update()/deactivate()
      // sobre DOS administradores distintos podían bloquear cada una su
      // propia fila usuarios primero y luego chocar tratando de bloquear
      // la fila roles/la fila del otro dentro de assertNoEsUltimoAdministrador
      // -- una espera circular real que MySQL resuelve con
      // ER_LOCK_DEADLOCK (500 sin manejar) en vez de un 409 limpio para
      // uno de los dos. Mismo mutex que ya usa bootstrap() en
      // auth.service.ts, extendido aquí a todo el módulo para garantizar
      // un único orden de bloqueo.
      await this.lockAdministradorRole(tx);

      // FOR UPDATE: mismo motivo que EmpresasService.update() -- serializa
      // contra un deactivate() concurrente sobre el mismo usuario.
      const [existing] = await tx
        .select({ id: usuarios.id, nombre: usuarios.nombre, correo: usuarios.correo, rol: roles.clave })
        .from(usuarios)
        .innerJoin(roles, eq(roles.id, usuarios.rolId))
        .where(and(eq(usuarios.id, id), eq(usuarios.activo, true)))
        .limit(1)
        .for("update");
      if (!existing) throw new HttpError(404, "Usuario no encontrado");

      // Comparación contra el valor actual (hallazgo de code review,
      // 14-sep-2026): sin esto, reenviar el mismo nombre/correo ya vigente
      // generaba un UPDATE sin cambios reales y, peor, una fila de
      // auditoría con antes===despues que sugería falsamente que algo
      // había cambiado -- mismo cuidado que ya se aplicaba a `rol` abajo.
      const set: Partial<typeof usuarios.$inferInsert> = {};
      if (input.nombre !== undefined && input.nombre !== existing.nombre) set.nombre = input.nombre;
      if (input.correo !== undefined && input.correo !== existing.correo) set.correo = input.correo;

      // "before"/"cambios" (campos legibles: nombre, correo, rol -- nunca
      // rolId crudo) es a propósito un objeto DISTINTO de `set` (columnas
      // reales de la tabla, con rolId en vez de rol): así buildAntes
      // produce un antes/despues legible por humanos, igual que despues
      // de create() (rol, no rolId).
      const before = { nombre: existing.nombre, correo: existing.correo, rol: existing.rol };
      const cambios: Partial<typeof before> = {};
      if (input.nombre !== undefined && input.nombre !== existing.nombre) cambios.nombre = input.nombre;
      if (input.correo !== undefined && input.correo !== existing.correo) cambios.correo = input.correo;

      // rol: solo se toca si de verdad cambia -- a diferencia de
      // nombre/correo de arriba, aquí SÍ importa comparar contra el valor
      // actual porque cambiarlo dispara (cuando se sale de
      // "administrador") el guard de "no dejar el sistema sin
      // administradores", y no tiene sentido correrlo ni resolver un
      // rolId nuevo si el rol pedido es el mismo que ya tiene.
      if (input.rol !== undefined && input.rol !== existing.rol) {
        if (existing.rol === "administrador") {
          await this.assertNoEsUltimoAdministrador(tx, id);
        }
        const [nuevoRol] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.clave, input.rol)).limit(1);
        if (!nuevoRol) throw new HttpError(500, `Rol '${input.rol}' no encontrado (¿se corrieron las migraciones?)`);
        set.rolId = nuevoRol.id;
        cambios.rol = input.rol;
      }

      const antes: Record<string, unknown> = buildAntes(before, cambios);
      const despues: Record<string, unknown> = { ...cambios };

      // password ya viene hasheado desde antes de la transacción (arriba);
      // se agrega a `set` DESPUÉS de calcular antes/despues de arriba --
      // así buildAntes nunca lo ve, y el payload de auditoría solo
      // registra que hubo un cambio ("actualizada"), nunca la contraseña
      // en claro ni el hash. No hay entrada en `antes` para password: el
      // hash previo tampoco pertenece ahí.
      if (nuevoPasswordHash !== undefined) {
        set.passwordHash = nuevoPasswordHash;
        despues.password = "actualizada";
      }

      // Nada que cambiar de verdad (ej. PATCH que solo repite el rol
      // actual, sin ningún otro campo): no generar UPDATE ni fila de
      // auditoría vacía. actualizarUsuarioSchema exige al menos un campo
      // en el body, pero eso no garantiza que represente un cambio real.
      if (Object.keys(set).length === 0) return;

      try {
        await tx.update(usuarios).set(set).where(and(eq(usuarios.id, id), eq(usuarios.activo, true)));
      } catch (error) {
        if (isDuplicateEntry(error)) throw new HttpError(409, "Ya existe un usuario con ese correo");
        throw error;
      }

      await tx.insert(auditoria).values({
        usuarioId: actor.id,
        entidad: "usuario",
        entidadId: id,
        accion: "actualizar",
        antes,
        despues
      });
    });

    return this.get(id);
  }

  // Restringido a administrador (RolesGuard en el controller): administrar
  // cuentas/roles es más sensible que el resto de las mutaciones del CRM.
  async deactivate(actor: CurrentUser, id: number) {
    await this.db.transaction(async (tx) => {
      // Mismo orden fijo de locks que update() -- ver comentario ahí.
      await this.lockAdministradorRole(tx);

      const [existing] = await tx
        .select({ id: usuarios.id, rol: roles.clave })
        .from(usuarios)
        .innerJoin(roles, eq(roles.id, usuarios.rolId))
        .where(and(eq(usuarios.id, id), eq(usuarios.activo, true)))
        .limit(1)
        .for("update");
      if (!existing) throw new HttpError(404, "Usuario no encontrado");

      // Guard de auto-bloqueo ANTES del conteo de administradores: es más
      // específico (aplica también cuando hay otros administradores
      // activos) y evita que alguien se quede sin poder operar su propia
      // sesión por accidente.
      if (id === actor.id) {
        throw new HttpError(409, "No puedes desactivar tu propia cuenta");
      }

      if (existing.rol === "administrador") {
        await this.assertNoEsUltimoAdministrador(tx, id);
      }

      // activo pasa de true a false: siempre es un cambio real (mismo
      // razonamiento que EmpresasService.deactivate), así que 0 filas
      // afectadas solo puede significar que otra solicitud ganó la
      // carrera -- el FOR UPDATE de arriba ya lo hace casi imposible, esto
      // es una defensa adicional.
      const [result] = await tx.update(usuarios).set({ activo: false }).where(and(eq(usuarios.id, id), eq(usuarios.activo, true)));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "El usuario ya fue desactivado por otra solicitud");
      }

      await tx.insert(auditoria).values({
        usuarioId: actor.id,
        entidad: "usuario",
        entidadId: id,
        accion: "desactivar",
        antes: { activo: true },
        despues: { activo: false }
      });
    });
  }

  // Mutex de orden fijo: update()/deactivate() lo llaman como PRIMER lock
  // de la transacción, antes de tocar cualquier fila de usuarios (ver
  // comentario en update()). Mismo patrón exacto que bootstrap() en
  // auth.service.ts (bloquear la fila del rol, no la tabla usuarios, que
  // podría estar vacía).
  private async lockAdministradorRole(tx: DrizzleTx) {
    const [rol] = await tx.select({ id: roles.id }).from(roles).where(eq(roles.clave, "administrador")).limit(1).for("update");
    if (!rol) throw new HttpError(500, "Rol 'administrador' no encontrado (¿se corrieron las migraciones?)");
  }

  // Compartido por update() (rol saliendo de administrador) y
  // deactivate() (usuario administrador siendo desactivado). .for("update")
  // bloquea las filas de administradores activos contadas, así una
  // desactivación/cambio de rol concurrente sobre OTRO administrador no
  // puede colarse y dejar pasar a los dos a la vez por debajo del mínimo
  // de 1 -- mismo espíritu que el mutex FOR UPDATE de auth.service.ts
  // bootstrap(). Ya no puede provocar un deadlock con el lock de arriba
  // porque lockAdministradorRole() siempre corre primero en la misma
  // transacción (mismo orden de locks en las dos llamadas).
  private async assertNoEsUltimoAdministrador(tx: DrizzleTx, excludeUserId: number) {
    const [{ total }] = await tx
      .select({ total: count() })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(and(eq(roles.clave, "administrador"), eq(usuarios.activo, true), ne(usuarios.id, excludeUserId)))
      .for("update");

    if (total === 0) {
      throw new HttpError(409, "No puedes dejar el sistema sin al menos un administrador activo");
    }
  }
}
