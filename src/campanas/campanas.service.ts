import { Inject, Injectable } from "@nestjs/common";
import { count, desc, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, campanas, prospectos } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { campanaNoHaTerminadoSql, campanaYaEmpezoSql, vigenciaCampana } from "../shared/campana-vigente.js";
import { fechaMx } from "../shared/dia-habil.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { ERROR_RANGO_FECHAS_CAMPANA, type CrearCampanaInput, type EditarCampanaInput, type ListCampanasQuery } from "./dto/campana.schema.js";

type EstadoCampana = typeof campanas.$inferSelect["estado"];
export type AccionCampana = "activar" | "pausar" | "finalizar";

// Todas las transiciones en un solo mapa: desde qué estados se puede cada
// acción y a cuál lleva. "finalizada" es definitivo: no sale de ahí.
const TRANSICIONES: Record<AccionCampana, { desde: readonly EstadoCampana[]; hacia: EstadoCampana }> = {
  activar: { desde: ["borrador", "pausada"], hacia: "activa" },
  pausar: { desde: ["activa"], hacia: "pausada" },
  finalizar: { desde: ["borrador", "activa", "pausada"], hacia: "finalizada" }
};

export const CODIGO_TRANSICION_CAMPANA_INVALIDA = "TRANSICION_CAMPANA_INVALIDA";
export const CODIGO_CAMPANA_FINALIZADA = "CAMPANA_FINALIZADA";
export const CODIGO_CAMPANA_VENCIDA = "CAMPANA_VENCIDA";

// Campañas (1-oct-2026). La tabla existía desde 003_campanas_y_parametros
// pero no había forma de crearlas: sin campaña, PT1 y PT4 solo funcionan en
// modo pruebas. Si una campaña manda hoy lo decide la misma regla que usan
// "Campaña activa" (PT1) y /envios/vencidas (shared/campana-vigente.ts):
// activa_hoy y motivo salen de ahí. Pausada = en espera: sus recordatorios
// esperan y PT1 no cierra a sus prospectos.
@Injectable()
export class CampanasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  private seleccion(hoy: string) {
    return {
      campana: campanas,
      prospectos: count(prospectos.id),
      yaEmpezo: campanaYaEmpezoSql(hoy),
      noHaTerminado: campanaNoHaTerminadoSql(hoy)
    };
  }

  private toRow(r: { campana: typeof campanas.$inferSelect; prospectos: number; yaEmpezo: unknown; noHaTerminado: unknown }) {
    const { vigencia, motivo } = vigenciaCampana(r.campana.estado, r.yaEmpezo as number, r.noHaTerminado as number);
    return {
      id: r.campana.id,
      nombre: r.campana.nombre,
      canal: r.campana.canal,
      estado: r.campana.estado,
      fecha_inicio: r.campana.fechaInicio,
      fecha_fin: r.campana.fechaFin,
      prospectos: Number(r.prospectos),
      activa_hoy: vigencia === "activa",
      motivo,
      creado_en: r.campana.creadoEn,
      actualizado_en: r.campana.actualizadoEn
    };
  }

  async list(query: ListCampanasQuery) {
    const hoy = fechaMx(new Date());
    const rows = await this.db
      .select(this.seleccion(hoy))
      .from(campanas)
      .leftJoin(prospectos, eq(prospectos.campanaId, campanas.id))
      .where(query.estado ? eq(campanas.estado, query.estado) : undefined)
      .groupBy(campanas.id)
      .orderBy(desc(campanas.creadoEn), desc(campanas.id))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);
    return { page: query.page, limit: query.limit, data: rows.map((r) => this.toRow(r)) };
  }

  async get(id: number) {
    const hoy = fechaMx(new Date());
    const [row] = await this.db
      .select(this.seleccion(hoy))
      .from(campanas)
      .leftJoin(prospectos, eq(prospectos.campanaId, campanas.id))
      .where(eq(campanas.id, id))
      .groupBy(campanas.id)
      .limit(1);
    if (!row) throw new HttpError(404, "Campaña no encontrada");
    return this.toRow(row);
  }

  // Siempre nace en borrador: activarla es un paso aparte y explícito.
  async create(user: CurrentUser, input: CrearCampanaInput) {
    const id = await this.db.transaction(async (tx) => {
      const [result] = await tx.insert(campanas).values({
        nombre: input.nombre,
        canal: input.canal,
        estado: "borrador",
        fechaInicio: input.fechaInicio ?? null,
        fechaFin: input.fechaFin ?? null
      });
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "campana",
        entidadId: result.insertId,
        accion: "crear",
        despues: { nombre: input.nombre, canal: input.canal, estado: "borrador", fecha_inicio: input.fechaInicio ?? null, fecha_fin: input.fechaFin ?? null }
      });
      return result.insertId;
    });
    return this.get(id);
  }

  // Lee la campaña dentro de la transacción y la deja bloqueada hasta el
  // commit (B7 del plan de fixes, 2-oct-2026). Antes se leía afuera: dos
  // ediciones al mismo tiempo validaban cada una contra la versión vieja y
  // podían dejar fecha de inicio después de la de fin, y la auditoría
  // guardaba un "antes" que ya no era cierto.
  private async bloquear(tx: DrizzleTx, id: number) {
    const [actual] = await tx.select().from(campanas).where(eq(campanas.id, id)).limit(1).for("update");
    if (!actual) throw new HttpError(404, "Campaña no encontrada");
    return actual;
  }

  // Nombre y fechas. Una finalizada ya no se edita: es el registro de lo
  // que pasó. El rango de fechas se valida contra lo que ya está guardado.
  async update(user: CurrentUser, id: number, input: EditarCampanaInput) {
    const hoy = fechaMx(new Date());
    await this.db.transaction(async (tx) => {
      const actual = await this.bloquear(tx, id);
      if (actual.estado === "finalizada") throw new HttpError(409, "La campaña ya está finalizada", CODIGO_CAMPANA_FINALIZADA);

      const fechaInicio = input.fechaInicio === undefined ? actual.fechaInicio : input.fechaInicio;
      const fechaFin = input.fechaFin === undefined ? actual.fechaFin : input.fechaFin;
      if (fechaInicio && fechaFin && fechaInicio > fechaFin) throw new HttpError(400, ERROR_RANGO_FECHAS_CAMPANA);
      // Una fecha de fin pasada deja vencida a una campaña que manda, y
      // PT4 cancela todos sus recordatorios: es terminarla sin decirlo.
      // Para eso está "finalizar". En borrador no manda nada, se permite.
      if (input.fechaFin && input.fechaFin < hoy && actual.estado !== "borrador") {
        throw new HttpError(409, "La fecha de fin no puede quedar en el pasado; para terminar la campaña usa finalizar", CODIGO_CAMPANA_VENCIDA);
      }

      const cambios = {
        ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
        ...(input.fechaInicio !== undefined ? { fechaInicio: input.fechaInicio } : {}),
        ...(input.fechaFin !== undefined ? { fechaFin: input.fechaFin } : {})
      };
      if (Object.keys(cambios).length === 0) return;

      await tx.update(campanas).set(cambios).where(eq(campanas.id, id));
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "campana",
        entidadId: id,
        accion: "editar",
        antes: { nombre: actual.nombre, fecha_inicio: actual.fechaInicio, fecha_fin: actual.fechaFin },
        despues: { nombre: input.nombre ?? actual.nombre, fecha_inicio: fechaInicio, fecha_fin: fechaFin }
      });
    });
    return this.get(id);
  }

  // activar / pausar / finalizar. La fila bloqueada hace que dos clics
  // simultáneos dejen una sola transición y una sola auditoría: el segundo
  // espera al primero y ya ve el estado nuevo.
  async cambiarEstado(user: CurrentUser, id: number, accion: AccionCampana) {
    await this.db.transaction(async (tx) => {
      const actual = await this.bloquear(tx, id);
      const { desde, hacia } = TRANSICIONES[accion];
      if (!desde.includes(actual.estado)) {
        throw new HttpError(409, `No se puede ${accion} una campaña ${actual.estado}`, CODIGO_TRANSICION_CAMPANA_INVALIDA);
      }
      // Activar una campaña que ya terminó no la haría mandar: mejor avisar.
      if (accion === "activar" && actual.fechaFin && actual.fechaFin < fechaMx(new Date())) {
        throw new HttpError(409, "La fecha de fin de la campaña ya pasó; cámbiala antes de activarla", CODIGO_CAMPANA_VENCIDA);
      }

      await tx.update(campanas).set({ estado: hacia }).where(eq(campanas.id, id));
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "campana",
        entidadId: id,
        accion,
        antes: { estado: actual.estado },
        despues: { estado: hacia }
      });
    });
    return this.get(id);
  }
}
