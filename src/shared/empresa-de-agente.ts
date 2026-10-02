import { and, eq } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, empresas, roles, usuarios } from "../database/schema.js";
import { HttpError } from "./http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";

export type Responsable = { id: number; rol: string; activo: boolean };

// A quién se le puede dar trabajo: una persona activa que pueda trabajarlo
// (no la cuenta "sistema" ni un usuario desactivado). Lo usan tareas y
// oportunidades.
export async function responsableAsignable(db: DrizzleDb | DrizzleTx, responsableId: number): Promise<Responsable> {
  const [destino] = await db
    .select({ id: usuarios.id, activo: usuarios.activo, rol: roles.clave })
    .from(usuarios)
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(eq(usuarios.id, responsableId))
    .limit(1);
  if (!destino || !destino.activo || destino.rol === "sistema") {
    throw new HttpError(409, "El responsable debe ser un usuario activo");
  }
  return destino;
}

// Asignar = dar dueño (C1 del plan de fixes, 2-oct-2026). Un agente solo ve
// las empresas de las que es dueño, y las que crea n8n nacen sin dueño: el
// agente al que se le asignaba "Contactar prospecto interesado" veía la
// tarea pero la ficha le daba 404. Cuando un admin o supervisor le da
// trabajo de una empresa a un agente, la empresa pasa a ese agente si hoy no
// tiene como dueño a otro agente activo (sin dueño, a nombre de un admin o
// supervisor, o de un agente desactivado). Si ya es de otro agente activo,
// no se toca: la asignación sigue, y decide el supervisor.
//
// Solo cuando asigna un admin o supervisor: si no, un agente se quedaría con
// cualquier empresa creándose a sí mismo una tarea sobre ella. Y solo hacia
// agentes: un supervisor ya ve todo, y si la empresa quedara a su nombre
// ningún agente podría verla.
//
// Lee la empresa con FOR UPDATE dentro de la transacción del llamador: dos
// asignaciones al mismo tiempo a agentes distintos dejan un solo dueño y una
// sola auditoría.
export async function darEmpresaAlAgente(
  tx: DrizzleTx,
  datos: { empresaId: number; responsable: Responsable; actor: CurrentUser; origen: { tarea_id: number } | { oportunidad_id: number } }
): Promise<boolean> {
  const { empresaId, responsable, actor, origen } = datos;
  if (actor.rol !== "administrador" && actor.rol !== "supervisor") return false;
  if (responsable.rol !== "agente" || !responsable.activo) return false;

  const [empresa] = await tx.select({ propietarioId: empresas.propietarioId }).from(empresas).where(and(eq(empresas.id, empresaId), eq(empresas.activo, true))).limit(1).for("update");
  if (!empresa || empresa.propietarioId === responsable.id) return false;

  if (empresa.propietarioId !== null) {
    const [dueno] = await tx
      .select({ activo: usuarios.activo, rol: roles.clave })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(eq(usuarios.id, empresa.propietarioId))
      .limit(1);
    if (dueno && dueno.activo && dueno.rol === "agente") return false;
  }

  await tx.update(empresas).set({ propietarioId: responsable.id }).where(eq(empresas.id, empresaId));
  await tx.insert(auditoria).values({
    usuarioId: actor.id,
    entidad: "empresa",
    entidadId: empresaId,
    accion: "tomar_empresa",
    antes: { propietario_id: empresa.propietarioId },
    despues: { propietario_id: responsable.id, ...origen }
  });
  return true;
}
