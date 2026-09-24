import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, contactos, mediosContacto, prospectos, respuestas, tareas } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { registrarSupresion } from "../shared/supresion.js";
import { ESTADO_PROSPECTO_POR_CLASIFICACION } from "../shared/clasificacion-respuesta.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { ALERTAS_BATCH_SIZE } from "../shared/jobs.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CrearTareaInput, ClasificarTareaInput } from "./dto/tarea.schema.js";
import type { TareaAutomatizacionInput } from "../automatizacion/dto/automatizacion.schema.js";

export type ListTareasFilters = {
  estado?: "pendiente" | "en_progreso" | "cerrada" | "cancelada";
  prioridad?: "baja" | "media" | "alta" | "urgente";
  tipo?: "seguimiento" | "clasificacion" | "revision_documento" | "otro";
  responsableId?: number;
};

function toRow(row: typeof tareas.$inferSelect) {
  return {
    id: row.id,
    tipo: row.tipo,
    titulo: row.titulo,
    descripcion: row.descripcion,
    estado: row.estado,
    prioridad: row.prioridad,
    responsable_id: row.responsableId,
    empresa_id: row.empresaId,
    contacto_id: row.contactoId,
    prospecto_id: row.prospectoId,
    respuesta_id: row.respuestaId,
    fecha_limite: row.fechaLimite,
    clasificacion: row.clasificacion,
    resultado: row.resultado,
    cerrada_en: row.cerradaEn,
    creada_por: row.creadaPor,
    creado_en: row.creadoEn,
    actualizado_en: row.actualizadoEn
  };
}

@Injectable()
export class TareasService {
  private readonly logger = new Logger(TareasService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly outboxService: OutboxService
  ) {}

  // La bandeja de tareas: el agente solo ve lo suyo (PLAN_CRM_DEFINITIVO.md
  // "El agente ve sus empresas, contactos, tareas y oportunidades
  // asignadas"); administrador y supervisor pueden ver o filtrar por
  // cualquier responsable.
  private scopedFilters(user: CurrentUser, filters: ListTareasFilters): ListTareasFilters {
    if (user.rol === "agente") return { ...filters, responsableId: user.id };
    return filters;
  }

  async list(user: CurrentUser, filters: ListTareasFilters, page: number, limit: number) {
    const scoped = this.scopedFilters(user, filters);
    const offset = (page - 1) * limit;

    const conditions = compactConditions([
      scoped.estado ? eq(tareas.estado, scoped.estado) : undefined,
      scoped.prioridad ? eq(tareas.prioridad, scoped.prioridad) : undefined,
      scoped.tipo ? eq(tareas.tipo, scoped.tipo) : undefined,
      scoped.responsableId ? eq(tareas.responsableId, scoped.responsableId) : undefined
    ]);

    const rows = await this.db
      .select()
      .from(tareas)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tareas.prioridad), tareas.fechaLimite)
      .limit(limit)
      .offset(offset);

    return { page, limit, data: rows.map(toRow) };
  }

  async create(user: CurrentUser, input: CrearTareaInput) {
    const [result] = await this.db.insert(tareas).values({
      tipo: input.tipo,
      titulo: input.titulo,
      descripcion: input.descripcion ?? null,
      prioridad: input.prioridad,
      responsableId: input.responsableId,
      empresaId: input.empresaId ?? null,
      contactoId: input.contactoId ?? null,
      prospectoId: input.prospectoId ?? null,
      fechaLimite: input.fechaLimite ?? null,
      creadaPor: user.id
    });
    return result.insertId;
  }

  async get(user: CurrentUser, id: number) {
    const [row] = await this.db.select().from(tareas).where(eq(tareas.id, id)).limit(1);
    if (!row || (user.rol === "agente" && row.responsableId !== user.id)) {
      throw new HttpError(404, "Tarea no encontrada");
    }
    return toRow(row);
  }

  private async findAssignable(user: CurrentUser, id: number) {
    const [row] = await this.db.select().from(tareas).where(eq(tareas.id, id)).limit(1);
    if (!row || (user.rol === "agente" && row.responsableId !== user.id)) {
      throw new HttpError(404, "Tarea no encontrada");
    }
    if (row.estado === "cerrada" || row.estado === "cancelada") {
      throw new HttpError(409, "La tarea ya está cerrada");
    }
    return row;
  }

  // Cerrar una tarea genera un evento en eventos_pendientes (patrón outbox
  // obligatorio, PLAN_CRM_DEFINITIVO.md #5): nunca se llama a n8n desde aquí
  // directamente, solo se encola el evento en la misma transacción.
  async cerrar(user: CurrentUser, id: number, resultado: string) {
    const row = await this.findAssignable(user, id);

    await this.db.transaction(async (tx) => {
      // findAssignable ya validó el estado, pero fuera de cualquier
      // bloqueo -- dos PATCH concurrentes sobre la misma tarea podían
      // pasar ambos el guard y duplicar el evento de outbox. Revalidar
      // dentro del propio UPDATE (WHERE ... AND estado NOT IN (...)) y
      // chequear affectedRows cierra la carrera (hallazgo de code review,
      // 10-sep-2026).
      const [result] = await tx.update(tareas).set({
        estado: "cerrada",
        resultado,
        cerradaEn: sql`CURRENT_TIMESTAMP`
      }).where(and(eq(tareas.id, id), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
      if (result.affectedRows === 0) throw new HttpError(409, "La tarea ya está cerrada");

      await this.outboxService.enqueue(tx, {
        tipo: "tarea_cerrada",
        entidadTipo: "tarea",
        entidadId: id,
        payload: { tarea_id: id, tipo: row.tipo, resultado, cerrada_por: user.id }
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "tarea",
        entidadId: id,
        accion: "cerrar",
        despues: { resultado }
      });
    });
  }

  // Cola de clasificación manual: solo tareas tipo 'clasificacion'.
  async listColaClasificacion(user: CurrentUser, page: number, limit: number) {
    return this.list(user, { tipo: "clasificacion", estado: "pendiente" }, page, limit);
  }

  // La decisión de la persona se aplica aquí mismo, en una sola transacción
  // (antes solo se cerraba la tarea y se encolaba el evento, y nada la
  // aplicaba: n8n no tenía cómo -- hallazgo de revisión, 24-sep-2026):
  // - la respuesta que originó la tarea (respuesta_id) queda con esta
  //   clasificación;
  // - el prospecto pasa al estado de ESTADO_PROSPECTO_POR_CLASIFICACION;
  // - "baja" registra la supresión de los medios del contacto por el canal
  //   de la respuesta (obligación legal: no puede depender de que n8n
  //   reciba el evento);
  // - "reagendar" crea una tarea de seguimiento para quien clasificó.
  // El evento prospecto_clasificado sigue saliendo, solo como aviso.
  async clasificar(user: CurrentUser, id: number, input: ClasificarTareaInput) {
    const row = await this.findAssignable(user, id);
    if (row.tipo !== "clasificacion") {
      throw new HttpError(409, "Solo las tareas de clasificación se resuelven aquí");
    }
    if (!row.prospectoId) {
      throw new HttpError(409, "La tarea de clasificación no tiene un prospecto asociado");
    }
    const prospectoId = row.prospectoId;

    await this.db.transaction(async (tx) => {
      // Misma revalidación que cerrar() -- ver comentario ahí. Va primero:
      // si otra clasificación de la misma tarea ganó la carrera, esta
      // termina aquí sin haber escrito nada más.
      const [result] = await tx.update(tareas).set({
        estado: "cerrada",
        clasificacion: input.clasificacion,
        resultado: input.comentario ?? input.clasificacion,
        cerradaEn: sql`CURRENT_TIMESTAMP`
      }).where(and(eq(tareas.id, id), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
      if (result.affectedRows === 0) throw new HttpError(409, "La tarea ya está cerrada");

      // Tareas de clasificación anteriores a 022_clasificacion_manual.sql, o
      // creadas a mano, no tienen respuesta: el canal por omisión es correo.
      let canal: "correo" | "whatsapp" = "correo";
      if (row.respuestaId) {
        const [respuesta] = await tx.select({ canal: respuestas.canal }).from(respuestas).where(eq(respuestas.id, row.respuestaId)).limit(1);
        if (respuesta) canal = respuesta.canal;
        await tx.update(respuestas).set({
          estado: "clasificada",
          clasificacion: input.clasificacion,
          clasificadoEn: sql`CURRENT_TIMESTAMP`
        }).where(eq(respuestas.id, row.respuestaId));
      }

      const nuevoEstado = ESTADO_PROSPECTO_POR_CLASIFICACION[input.clasificacion];
      if (nuevoEstado) {
        await tx.update(prospectos).set({ estado: nuevoEstado }).where(eq(prospectos.id, prospectoId));
      }

      const supresionIds: number[] = [];
      if (input.clasificacion === "baja") {
        // No se sabe desde qué dirección contestó la persona, así que se
        // suprimen todos sus medios de ese canal.
        const medios = await tx
          .select({ valor: mediosContacto.valor })
          .from(mediosContacto)
          .innerJoin(prospectos, eq(prospectos.contactoId, mediosContacto.contactoId))
          .where(and(eq(prospectos.id, prospectoId), eq(mediosContacto.tipo, canal)));
        for (const medio of medios) {
          const supresion = await registrarSupresion(tx, {
            tipo: canal,
            valor: medio.valor,
            motivo: `Baja pedida en respuesta (clasificación manual, tarea ${id})`,
            executionId: null,
            usuarioId: user.id
          });
          supresionIds.push(supresion.id);
        }
      }

      let tareaSeguimientoId: number | null = null;
      if (input.clasificacion === "reagendar") {
        const [seguimiento] = await tx.insert(tareas).values({
          tipo: "seguimiento",
          titulo: "Seguimiento reagendado",
          descripcion: input.comentario ?? null,
          prioridad: "media",
          responsableId: user.id,
          empresaId: row.empresaId,
          contactoId: row.contactoId,
          prospectoId,
          fechaLimite: input.fechaSeguimiento!,
          creadaPor: user.id
        });
        tareaSeguimientoId = seguimiento.insertId;
      }

      await this.outboxService.enqueue(tx, {
        tipo: "prospecto_clasificado",
        entidadTipo: "prospecto",
        entidadId: prospectoId,
        payload: { tarea_id: id, prospecto_id: prospectoId, respuesta_id: row.respuestaId, clasificacion: input.clasificacion, comentario: input.comentario ?? null, clasificado_por: user.id, tarea_seguimiento_id: tareaSeguimientoId }
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "tarea",
        entidadId: id,
        accion: "clasificar",
        despues: { clasificacion: input.clasificacion, respuesta_id: row.respuestaId, estado_prospecto: nuevoEstado, supresion_ids: supresionIds, tarea_seguimiento_id: tareaSeguimientoId }
      });
    });
  }

  // Endpoint de automatización (n8n), no de sesión: PLAN_API_DEFINITIVO.md,
  // endpoint "Tareas" de la lista de 17. Diagrama PARTE 1/2, pasos 3a
  // (revisión manual tras agotar intentos de corrección) y 10 (alerta con
  // SLA para el Equipo CRM). Sin responsable_id ni creada_por (bandeja sin
  // asignar); idempotente por execution_id.
  //
  // `db` es opcional (default this.db) para que otro servicio que ya abrió
  // su propia transacción (p. ej. AutomatizacionService.registrarRespuesta)
  // pueda pasar su `tx` y que la tarea se cree atómicamente junto con el
  // resto de escrituras, en vez de quedar como una escritura suelta que
  // puede sobrevivir aunque el resto haga rollback (o viceversa) — hallazgo
  // de code review, 10-sep-2026.
  //
  // `respuesta_id` NO es parte del contrato de POST /automatizacion/tareas
  // (n8n no lo manda): solo lo pasa AutomatizacionService.clasificarRespuesta
  // al crear la tarea de una respuesta "ambigua", para que la clasificación
  // manual sepa qué respuesta está resolviendo.
  async createFromAutomation(input: TareaAutomatizacionInput & { respuesta_id?: number }, db: DrizzleDb | DrizzleTx = this.db) {
    const [existing] = await db.select({ id: tareas.id }).from(tareas).where(eq(tareas.executionId, input.execution_id)).limit(1);
    if (existing) return { id: existing.id, ya_existia: true as const };

    let contactoId: number | null = null;
    let empresaId: number | null = null;
    if (input.prospecto_id) {
      const [prospecto] = await db
        .select({ id: prospectos.id, contactoId: contactos.id, empresaId: contactos.empresaId })
        .from(prospectos)
        .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
        .where(eq(prospectos.id, input.prospecto_id))
        .limit(1);
      if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");
      contactoId = prospecto.contactoId;
      empresaId = prospecto.empresaId;
    }

    try {
      const [result] = await db.insert(tareas).values({
        tipo: input.tipo,
        titulo: input.titulo,
        descripcion: input.descripcion ?? null,
        prioridad: input.prioridad,
        responsableId: null,
        empresaId,
        contactoId,
        prospectoId: input.prospecto_id ?? null,
        respuestaId: input.respuesta_id ?? null,
        executionId: input.execution_id,
        fechaLimite: input.fecha_limite ? new Date(input.fecha_limite) : null,
        creadaPor: null
      });
      return { id: result.insertId, ya_existia: false as const };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [retry] = await db.select({ id: tareas.id }).from(tareas).where(eq(tareas.executionId, input.execution_id)).limit(1);
        if (retry) return { id: retry.id, ya_existia: true as const };
      }
      throw error;
    }
  }

  // "Alertas de tareas SLA vencidas" (PLAN_API_DEFINITIVO.md, "Jobs
  // internos"; ya anticipado en el comentario de createFromAutomation
  // arriba: "alerta con SLA para el Equipo CRM"). Mismo criterio que
  // DocumentosService.alertarDocumentosPendientes -- ver comentario ahí y
  // en 019_alertas_sla.sql: @Interval fijo diario, sin endpoint de disparo
  // manual, encola en eventos_pendientes en vez de llamar a n8n directo, y
  // alertado_en evita reencolar la misma tarea cada día. fecha_limite es
  // NULLABLE -- una tarea sin fecha límite nunca puede "vencer", y
  // lt(tareas.fechaLimite, ...) ya la excluye sola (NULL < X es falso en
  // SQL, no hace falta un isNotNull aparte).
  @Interval(24 * 60 * 60 * 1000)
  async alertarTareasSlaVencidas() {
    const candidatas = await this.db
      .select({ id: tareas.id, tipo: tareas.tipo, responsableId: tareas.responsableId, fechaLimite: tareas.fechaLimite })
      .from(tareas)
      .where(and(
        sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`,
        isNull(tareas.alertadoEn),
        lt(tareas.fechaLimite, sql`CURRENT_TIMESTAMP`)
      ))
      .limit(ALERTAS_BATCH_SIZE);

    let alertadas = 0;
    for (const tarea of candidatas) {
      const encolado = await this.db.transaction(async (tx) => {
        const [result] = await tx.update(tareas).set({ alertadoEn: sql`CURRENT_TIMESTAMP` }).where(and(eq(tareas.id, tarea.id), isNull(tareas.alertadoEn)));
        if (result.affectedRows === 0) return false;

        await this.outboxService.enqueue(tx, {
          tipo: "tarea_sla_vencida",
          entidadTipo: "tarea",
          entidadId: tarea.id,
          payload: { tarea_id: tarea.id, tipo: tarea.tipo, responsable_id: tarea.responsableId, fecha_limite: tarea.fechaLimite }
        });
        return true;
      });
      if (encolado) alertadas++;
    }

    if (alertadas > 0) this.logger.log(`${alertadas} tarea(s) con SLA vencido alertada(s)`);
    return alertadas;
  }
}
