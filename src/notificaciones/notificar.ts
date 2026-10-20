import { AsyncLocalStorage } from "node:async_hooks";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { empresas, notificaciones, roles, usuarios } from "../database/schema.js";

// Avisos de la campanita (etapa 2 de las mejoras, 19-oct-2026).
export type TipoAviso = "tarea_asignada" | "interesado" | "tarea_vencida" | "documento_rechazado" | "respuesta_por_clasificar" | "respuesta_conversacion";

export type Aviso = {
  tipo: TipoAviso;
  titulo: string;
  cuerpo?: string | null;
  // Ruta del CRM a la que lleva el clic.
  enlace?: string | null;
  entidad?: string;
  entidadId?: number;
  // Además de la campanita, un correo (si la persona no los apagó).
  conCorreo: boolean;
};

// Los avisos con correo que dejó cada petición. El correo no puede salir
// dentro de la transacción (si luego se deshace, se habría avisado de algo
// que no pasó), así que notificar() solo anota el id y
// EnviarAvisosInterceptor lo manda al terminar la petición, ya confirmada.
// Si no hay petición (o el proceso se cae antes), el aviso se queda
// 'pendiente' y lo levanta el reintento del trabajo diario.
export const avisosDeLaPeticion = new AsyncLocalStorage<{ pendientes: number[] }>();

// Crea el aviso para cada persona, dentro de la transacción de quien llama.
// Nunca a quien hizo la acción (actorId), ni a usuarios inactivos o a la
// cuenta "sistema". Ids repetidos o nulos se ignoran.
export async function notificar(tx: DrizzleTx, usuarioIds: readonly (number | null | undefined)[], aviso: Aviso, actorId?: number | null) {
  const ids = [...new Set(usuarioIds.filter((id): id is number => id != null && id !== actorId))];
  if (ids.length === 0) return;

  const destinatarios = await tx
    .select({ id: usuarios.id, avisosPorCorreo: usuarios.avisosPorCorreo })
    .from(usuarios)
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(and(inArray(usuarios.id, ids), eq(usuarios.activo, true), ne(roles.clave, "sistema")));

  for (const destinatario of destinatarios) {
    const conCorreo = aviso.conCorreo && destinatario.avisosPorCorreo;
    const [fila] = await tx.insert(notificaciones).values({
      usuarioId: destinatario.id,
      tipo: aviso.tipo,
      titulo: aviso.titulo.slice(0, 200),
      cuerpo: aviso.cuerpo ? aviso.cuerpo.slice(0, 1000) : null,
      enlace: aviso.enlace ?? null,
      entidad: aviso.entidad ?? null,
      entidadId: aviso.entidadId ?? null,
      correoEstado: conCorreo ? "pendiente" : "no_aplica"
    });
    if (conCorreo) avisosDeLaPeticion.getStore()?.pendientes.push(fila.insertId);
  }
}

// Administradores y supervisores activos: los que reparten el trabajo.
export async function adminsYSupervisores(db: DrizzleDb | DrizzleTx) {
  const filas = await db
    .select({ id: usuarios.id })
    .from(usuarios)
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(and(inArray(roles.clave, ["administrador", "supervisor"]), eq(usuarios.activo, true)));
  return filas.map((f) => f.id);
}

// El responsable, si sigue activo; si no hay (o ya no está), el equipo que
// reparte. `delEquipo` dice cuál de los dos fue, para el enlace.
export async function responsableOEquipo(db: DrizzleDb | DrizzleTx, responsableId: number | null) {
  if (responsableId !== null) {
    const [activo] = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(and(eq(usuarios.id, responsableId), eq(usuarios.activo, true), ne(roles.clave, "sistema")))
      .limit(1);
    if (activo) return { ids: [activo.id], delEquipo: false };
  }
  return { ids: await adminsYSupervisores(db), delEquipo: true };
}

// Enlaces de las tareas (TareasPage abre la tarea con ?tarea=). Sin
// alcance = "mías"; una tarea ajena se abre en "sin asignar" o "todas".
export function enlaceTarea(tareaId: number, alcance?: "sin_asignar" | "todas") {
  return `/tareas?vista=todas${alcance ? `&alcance=${alcance}` : ""}&tarea=${tareaId}`;
}

export async function nombreEmpresa(db: DrizzleDb | DrizzleTx, empresaId: number | null) {
  if (empresaId === null) return null;
  const [empresa] = await db
    .select({ nombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})` })
    .from(empresas)
    .where(eq(empresas.id, empresaId))
    .limit(1);
  return empresa?.nombre ?? null;
}

// "Título · Empresa", para el cuerpo de los avisos de tareas.
export function lineaDeTarea(titulo: string, empresa: string | null) {
  return [titulo, empresa].filter(Boolean).join(" · ");
}
