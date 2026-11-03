import { and, asc, count, eq, inArray, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, empresas, parametrosAutomatizacion, roles, tareas, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { darEmpresaAlAgente, type Responsable } from "../shared/empresa-de-agente.js";
import type { CurrentUser } from "../auth/current-user.type.js";

// Reparto automático de "Contactar prospecto interesado" (Fabián, 3-nov-2026).
// Con el interruptor prendido, la tarea nueva le toca a quien tenga menos
// interesados abiertos de la lista elegida en Administración; si empatan, al
// que hace más que no recibe uno, y luego en el orden de la lista. Si la
// empresa ya es de un agente activo, va con él aunque no esté en la lista.
// Empieza apagado: así no le caen interesados reales a una cuenta de prueba
// antes de que el equipo de ventas esté dado de alta.
export const CLAVE_REPARTO_INTERESADOS = "reparto_interesados";
// Mismo título que TITULO_TAREA_INTERESADO (tareas.service.ts); aquí para no
// importar el servicio desde un archivo que el servicio importa.
const TITULO = "Contactar prospecto interesado";

export const repartoInteresadosSchema = z.object({
  activo: z.boolean(),
  usuarioIds: z.array(z.coerce.number().int().positive()).max(50)
});
export type RepartoInteresadosInput = z.infer<typeof repartoInteresadosSchema>;

type Reparto = { activo: boolean; usuarioIds: number[] };

export async function leerReparto(db: DrizzleDb | DrizzleTx): Promise<Reparto> {
  const [fila] = await db.select({ valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion).where(eq(parametrosAutomatizacion.clave, CLAVE_REPARTO_INTERESADOS)).limit(1);
  const valor = (fila?.valor ?? {}) as { activo?: unknown; usuario_ids?: unknown };
  return {
    activo: valor.activo === true,
    usuarioIds: Array.isArray(valor.usuario_ids) ? valor.usuario_ids.filter((id): id is number => typeof id === "number") : []
  };
}

// Interesados abiertos por persona y cuándo le tocó el último.
async function cargaDe(db: DrizzleDb | DrizzleTx, usuarioIds: number[]) {
  if (usuarioIds.length === 0) return new Map<number, { abiertas: number; ultima: Date | null }>();
  const abiertas = await db
    .select({ id: tareas.responsableId, n: count() })
    .from(tareas)
    .where(and(inArray(tareas.responsableId, usuarioIds), eq(tareas.titulo, TITULO), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`))
    .groupBy(tareas.responsableId);
  const ultimas = await db
    .select({ id: tareas.responsableId, ultima: max(tareas.creadoEn) })
    .from(tareas)
    .where(and(inArray(tareas.responsableId, usuarioIds), eq(tareas.titulo, TITULO)))
    .groupBy(tareas.responsableId);
  return new Map(usuarioIds.map((id) => [id, {
    abiertas: Number(abiertas.find((a) => a.id === id)?.n ?? 0),
    ultima: ultimas.find((u) => u.id === id)?.ultima ?? null
  }]));
}

// A quién le toca la tarea de interesado de esta empresa, o null (apagado,
// o nadie disponible: queda sin asignar, como antes).
async function elegir(tx: DrizzleTx, empresaId: number): Promise<Responsable | null> {
  const reparto = await leerReparto(tx);
  if (!reparto.activo) return null;

  const [dueno] = await tx
    .select({ id: usuarios.id, activo: usuarios.activo, rol: roles.clave })
    .from(empresas)
    .innerJoin(usuarios, eq(usuarios.id, empresas.propietarioId))
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(eq(empresas.id, empresaId))
    .limit(1);
  if (dueno && dueno.activo && dueno.rol === "agente") return dueno;

  if (reparto.usuarioIds.length === 0) return null;
  // FOR UPDATE: dos interesados al mismo tiempo no se le cargan los dos al
  // mismo por haber leído la misma cuenta.
  const disponibles = await tx
    .select({ id: usuarios.id, activo: usuarios.activo, rol: roles.clave })
    .from(usuarios)
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(and(inArray(usuarios.id, reparto.usuarioIds), eq(usuarios.activo, true), ne(roles.clave, "sistema")))
    .orderBy(asc(usuarios.id))
    .for("update");
  if (disponibles.length === 0) return null;

  const carga = await cargaDe(tx, disponibles.map((d) => d.id));
  const orden = (id: number) => reparto.usuarioIds.indexOf(id);
  const [elegido] = [...disponibles].sort((a, b) => {
    const ca = carga.get(a.id)!;
    const cb = carga.get(b.id)!;
    if (ca.abiertas !== cb.abiertas) return ca.abiertas - cb.abiertas;
    const ua = ca.ultima?.getTime() ?? -Infinity;
    const ub = cb.ultima?.getTime() ?? -Infinity;
    if (ua !== ub) return ua - ub;
    return orden(a.id) - orden(b.id);
  });
  return elegido ?? null;
}

// Asigna la tarea recién creada, con auditoría, y le da la empresa al agente
// (asignar = dar dueño, shared/empresa-de-agente.ts). Regresa a quién, o null.
export async function repartirInteresado(tx: DrizzleTx, datos: { tareaId: number; empresaId: number | null; actorId: number | null }) {
  if (datos.empresaId === null) return null;
  const responsable = await elegir(tx, datos.empresaId);
  if (!responsable) return null;
  await tx.update(tareas).set({ responsableId: responsable.id }).where(eq(tareas.id, datos.tareaId));
  await tx.insert(auditoria).values({
    usuarioId: datos.actorId,
    entidad: "tarea",
    entidadId: datos.tareaId,
    accion: "asignar",
    antes: { responsable_id: null },
    despues: { responsable_id: responsable.id, motivo: "reparto_automatico" }
  });
  await darEmpresaAlAgente(tx, { empresaId: datos.empresaId, responsable, actor: { id: datos.actorId, rol: "reparto" }, origen: { tarea_id: datos.tareaId } });
  return responsable.id;
}

// Lo que enseña Administración: el interruptor, la lista y, de cada persona
// que se puede poner, si está y cuántos interesados abiertos tiene.
export async function verReparto(db: DrizzleDb) {
  const reparto = await leerReparto(db);
  const personas = await db
    .select({ id: usuarios.id, nombre: usuarios.nombre, rol: roles.clave })
    .from(usuarios)
    .innerJoin(roles, eq(roles.id, usuarios.rolId))
    .where(and(eq(usuarios.activo, true), ne(roles.clave, "sistema")))
    .orderBy(asc(usuarios.nombre));
  const carga = await cargaDe(db, personas.map((p) => p.id));
  return {
    activo: reparto.activo,
    usuario_ids: reparto.usuarioIds,
    usuarios: personas.map((p) => ({ ...p, en_reparto: reparto.usuarioIds.includes(p.id), abiertas: carga.get(p.id)?.abiertas ?? 0 }))
  };
}

// Solo personas activas que puedan trabajar (no "sistema"). En auditoria no
// tiene id propio: entidad_id 0, como el pie de los correos.
export async function guardarReparto(db: DrizzleDb, user: CurrentUser, input: RepartoInteresadosInput) {
  const ids = [...new Set(input.usuarioIds)];
  if (ids.length > 0) {
    const validos = await db
      .select({ id: usuarios.id })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(and(inArray(usuarios.id, ids), eq(usuarios.activo, true), ne(roles.clave, "sistema")));
    if (validos.length !== ids.length) throw new HttpError(400, "Solo se pueden poner en el reparto personas activas del equipo");
  }
  await db.transaction(async (tx) => {
    const antes = await leerReparto(tx);
    const valor = { activo: input.activo, usuario_ids: ids };
    if (antes.activo === input.activo && JSON.stringify(antes.usuarioIds) === JSON.stringify(ids)) return;
    await tx
      .insert(parametrosAutomatizacion)
      .values({ clave: CLAVE_REPARTO_INTERESADOS, valor, descripcion: "Reparto automatico de la tarea de interesado; se edita en Administracion" })
      .onDuplicateKeyUpdate({ set: { valor } });
    await tx.insert(auditoria).values({ usuarioId: user.id, entidad: "reparto_interesados", entidadId: 0, accion: "editar", antes: { activo: antes.activo, usuario_ids: antes.usuarioIds }, despues: valor });
  });
  return verReparto(db);
}

