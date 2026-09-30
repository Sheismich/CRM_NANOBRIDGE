import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, desc, eq, isNull, lt, ne, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, contactos, empresas, prospectos, respuestas, roles, tareas, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { aplicarClasificacionAlProspecto, type ClasificacionRespuesta, type OrigenClasificacion } from "../shared/clasificacion-respuesta.js";
import { recortarTexto } from "../shared/texto.js";
import { CODIGO_RESPUESTA_YA_CLASIFICADA } from "../shared/clasificaciones.js";
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

// Largo de respuestas.comentario (VARCHAR(500)).
const MAX_COMENTARIO_RESPUESTA = 500;

// Una clasificación ya decidida (por una persona o por n8n), lista para
// aplicarse con aplicarClasificacionDeRespuesta.
export type ClasificacionDeRespuesta = {
  prospectoId: number;
  // NULL: tarea de clasificación creada a mano (POST /tareas), sin respuesta.
  respuestaId: number | null;
  clasificacion: ClasificacionRespuesta;
  comentario: string | null;
  // Texto de la respuesta, para la descripción de la tarea que se cree.
  contenido: string | null;
  // Solo con "reagendar": fecha de la tarea de seguimiento.
  fechaSeguimiento: Date | null;
  origen: OrigenClasificacion;
  // Qué respuestas se pueden clasificar: n8n, solo una que siga pendiente;
  // una persona en la cola, también una "ambigua" (resolverla es justo para
  // lo que existe la cola). Ninguno pisa una decisión ya tomada.
  guarda: "pendiente" | "pendiente_o_ambigua";
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

    // empresa_nombre: la bandeja lo necesita para decir de quién es cada
    // tarea sin pedir /empresas/:id por fila.
    const rows = await this.db
      .select({ tarea: tareas, empresaNombre: empresas.nombreLegal })
      .from(tareas)
      .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(tareas.prioridad), tareas.fechaLimite)
      .limit(limit)
      .offset(offset);

    return { page, limit, data: rows.map((r) => ({ ...toRow(r.tarea), empresa_nombre: r.empresaNombre })) };
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

  // codigoSiCerrada: el `code` del 409 cuando la tarea ya está cerrada (la
  // cola de clasificación lo usa para decir "ya la clasificó otra persona o
  // la IA").
  private async findAssignable(user: CurrentUser, id: number, codigoSiCerrada?: string) {
    const [row] = await this.db.select().from(tareas).where(eq(tareas.id, id)).limit(1);
    if (!row || (user.rol === "agente" && row.responsableId !== user.id)) {
      throw new HttpError(404, "Tarea no encontrada");
    }
    if (row.estado === "cerrada" || row.estado === "cancelada") {
      throw new HttpError(409, "La tarea ya está cerrada", codigoSiCerrada);
    }
    return row;
  }

  // Solo a una persona activa que pueda trabajarla (no a la cuenta
  // "sistema" ni a un usuario desactivado), y solo mientras siga abierta.
  // Misma revalidación del estado dentro del UPDATE que cerrar(): si otra
  // persona la cerró entre la lectura y la escritura, no se reasigna.
  async asignar(user: CurrentUser, id: number, responsableId: number) {
    const row = await this.findAssignable(user, id);
    const [destino] = await this.db
      .select({ id: usuarios.id, activo: usuarios.activo, rol: roles.clave })
      .from(usuarios)
      .innerJoin(roles, eq(roles.id, usuarios.rolId))
      .where(eq(usuarios.id, responsableId))
      .limit(1);
    if (!destino || !destino.activo || destino.rol === "sistema") {
      throw new HttpError(409, "El responsable debe ser un usuario activo");
    }
    if (row.responsableId === responsableId) return;

    await this.db.transaction(async (tx) => {
      const [result] = await tx.update(tareas).set({ responsableId })
        .where(and(eq(tareas.id, id), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
      if (result.affectedRows === 0) throw new HttpError(409, "La tarea ya está cerrada");
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "tarea",
        entidadId: id,
        accion: "asignar",
        antes: { responsable_id: row.responsableId },
        despues: { responsable_id: responsableId }
      });
    });
  }

  // Cerrar una tarea genera un evento en eventos_pendientes (patrón outbox
  // obligatorio, PLAN_CRM_DEFINITIVO.md #5): nunca se llama a n8n desde aquí
  // directamente, solo se encola el evento en la misma transacción.
  async cerrar(user: CurrentUser, id: number, resultado: string) {
    const row = await this.findAssignable(user, id);
    // Una tarea de clasificación cerrada por aquí quedaba "resuelta" sin
    // aplicar nada: la respuesta sin clasificar y el prospecto en
    // en_revision para siempre (hallazgo de /code-review, 25-sep-2026).
    if (row.tipo === "clasificacion") {
      throw new HttpError(409, "Las tareas de clasificación se resuelven clasificándolas (POST /cola-clasificacion/:id/clasificar)");
    }

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
  // Para clasificar hay que leer lo que contestó el prospecto: cada tarea de
  // la cola trae su empresa, su contacto y la respuesta que la originó
  // (texto, canal y lo que sugirió n8n, normalmente "ambigua"). Antes
  // devolvía la tarea sola y la pantalla no tenía qué mostrar. Las más
  // viejas primero dentro de cada prioridad: es una cola.
  async listColaClasificacion(user: CurrentUser, page: number, limit: number) {
    const scoped = this.scopedFilters(user, {});
    const rows = await this.db
      .select({
        tarea: tareas,
        empresaNombre: empresas.nombreLegal,
        contactoNombre: contactos.nombre,
        contactoPuesto: contactos.puesto,
        respuestaCanal: respuestas.canal,
        respuestaContenido: respuestas.contenido,
        respuestaRecibidoEn: respuestas.recibidoEn,
        respuestaClasificacion: respuestas.clasificacion
      })
      .from(tareas)
      .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
      .leftJoin(contactos, eq(contactos.id, tareas.contactoId))
      .leftJoin(respuestas, eq(respuestas.id, tareas.respuestaId))
      .where(and(...compactConditions([
        eq(tareas.tipo, "clasificacion"),
        eq(tareas.estado, "pendiente"),
        scoped.responsableId ? eq(tareas.responsableId, scoped.responsableId) : undefined
      ])))
      .orderBy(desc(tareas.prioridad), tareas.creadoEn, tareas.id)
      .limit(limit)
      .offset((page - 1) * limit);

    return {
      page,
      limit,
      data: rows.map((r) => ({
        ...toRow(r.tarea),
        empresa_nombre: r.empresaNombre,
        contacto_nombre: r.contactoNombre,
        contacto_puesto: r.contactoPuesto,
        respuesta: r.tarea.respuestaId
          ? { id: r.tarea.respuestaId, canal: r.respuestaCanal, contenido: r.respuestaContenido, recibido_en: r.respuestaRecibidoEn, clasificacion_sugerida: r.respuestaClasificacion }
          : null
      }))
    };
  }

  // Lo que pasa cuando se decide la clasificación de una respuesta, igual la
  // decida una persona en la cola (clasificar, abajo) o n8n
  // (AutomatizacionService.clasificarRespuesta). Antes cada camino tenía su
  // copia y ya no coincidían: la manual no guardaba el comentario en la
  // respuesta, por ejemplo (hallazgo de /code-review, 30-sep-2026). Corre
  // en la transacción de quien llama:
  // - la respuesta queda con esta clasificación;
  // - el prospecto cambia de estado y, con "baja", se suprimen todos los
  //   medios de su contacto (aplicarClasificacionAlProspecto; obligación
  //   legal: no puede depender de que n8n reciba un evento);
  // - la tarea que sigue: "ambigua" va a la cola de clasificación y
  //   "reagendar" deja un seguimiento para quien clasificó.
  // El evento para n8n y la auditoría de la tarea o de la respuesta los
  // escribe cada camino.
  async aplicarClasificacionDeRespuesta(tx: DrizzleTx, input: ClasificacionDeRespuesta) {
    if (input.respuestaId !== null) {
      // Solo se pisa el comentario y el execution_id si esta clasificación
      // los trae: una persona que resuelve una "ambigua" sin comentar no
      // debe borrar lo que dejó n8n.
      const [result] = await tx.update(respuestas).set({
        estado: "clasificada",
        clasificacion: input.clasificacion,
        ...(input.comentario !== null ? { comentario: recortarTexto(input.comentario, MAX_COMENTARIO_RESPUESTA) } : {}),
        ...(input.origen.executionId !== null ? { executionIdClasificacion: input.origen.executionId } : {}),
        clasificadoEn: sql`CURRENT_TIMESTAMP`
      }).where(and(...compactConditions([
        eq(respuestas.id, input.respuestaId),
        // Revalidación dentro del UPDATE (hallazgo de code review,
        // 14-sep-2026): dos clasificaciones simultáneas de la misma
        // respuesta pasaban ambas la lectura previa de quien llama, y la
        // segunda pisaba en silencio a la primera.
        // Una persona que llega a una respuesta ya decidida (por la IA o
        // por otra persona) no la pisa: antes el UPDATE manual no revisaba
        // nada (hallazgo de /code-review, 30-sep-2026).
        input.guarda === "pendiente"
          ? ne(respuestas.estado, "clasificada")
          : or(ne(respuestas.estado, "clasificada"), eq(respuestas.clasificacion, "ambigua"))
      ])));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "La respuesta ya fue clasificada por otra solicitud", CODIGO_RESPUESTA_YA_CLASIFICADA);
      }
    }

    const { estadoProspecto, supresionIds } = await aplicarClasificacionAlProspecto(tx, input.prospectoId, input.clasificacion, input.origen);

    let tareaId: number | null = null;
    if (input.clasificacion === "ambigua") {
      // Si la respuesta ya tiene su tarea en la cola (PT2 la crea con
      // crear_tarea_clasificacion), se reusa: antes nacía una segunda.
      const [abierta] = input.respuestaId === null ? [] : await tx
        .select({ id: tareas.id })
        .from(tareas)
        .where(and(eq(tareas.respuestaId, input.respuestaId), eq(tareas.tipo, "clasificacion"), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`))
        .orderBy(tareas.id)
        .limit(1);
      tareaId = abierta?.id ?? (await this.createFromAutomation({
        execution_id: `resp-clasif-${input.origen.executionId}`,
        prospecto_id: input.prospectoId,
        respuesta_id: input.respuestaId ?? undefined,
        tipo: "clasificacion",
        titulo: "Clasificar respuesta ambigua",
        descripcion: input.comentario ?? input.contenido ?? undefined,
        prioridad: "media"
      }, tx)).id;
    } else if (input.respuestaId !== null) {
      // Ya hay decisión: las tareas de clasificación de esta respuesta que
      // sigan abiertas se cierran con ella. Sin esto, si la IA clasificaba
      // directo, la tarea de PT2 se quedaba en la cola y una persona podía
      // pisar la decisión. La tarea que resolvió una persona ya viene
      // cerrada (clasificar la cierra primero), así que no entra aquí.
      await tx.update(tareas).set({
        estado: "cerrada",
        clasificacion: input.clasificacion,
        resultado: `Clasificada como ${input.clasificacion} (${input.origen.descripcion})`,
        cerradaEn: sql`CURRENT_TIMESTAMP`
      }).where(and(eq(tareas.respuestaId, input.respuestaId), eq(tareas.tipo, "clasificacion"), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`));
    }

    if (input.clasificacion === "reagendar") {
      const { empresaId, contactoId } = await this.contextoDeProspecto(tx, input.prospectoId);
      const [seguimiento] = await tx.insert(tareas).values({
        tipo: "seguimiento",
        titulo: "Seguimiento reagendado",
        descripcion: input.comentario,
        prioridad: "media",
        responsableId: input.origen.usuarioId,
        empresaId,
        contactoId,
        prospectoId: input.prospectoId,
        fechaLimite: input.fechaSeguimiento,
        creadaPor: input.origen.usuarioId
      });
      tareaId = seguimiento.insertId;
    }

    return { estadoProspecto, supresionIds, tareaId };
  }

  // La decisión de la persona se aplica aquí mismo, en una sola transacción
  // (antes solo se cerraba la tarea y se encolaba el evento, y nada la
  // aplicaba: n8n no tenía cómo -- hallazgo de revisión, 24-sep-2026); ver
  // aplicarClasificacionDeRespuesta. El evento prospecto_clasificado sigue
  // saliendo, solo como aviso.
  async clasificar(user: CurrentUser, id: number, input: ClasificarTareaInput) {
    const row = await this.findAssignable(user, id, CODIGO_RESPUESTA_YA_CLASIFICADA);
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
      if (result.affectedRows === 0) throw new HttpError(409, "La tarea ya está cerrada", CODIGO_RESPUESTA_YA_CLASIFICADA);

      // Las tareas de clasificación creadas a mano (POST /tareas) no tienen
      // respuesta; las anteriores a 022 la recuperan con su backfill.
      const { estadoProspecto, supresionIds, tareaId: tareaSeguimientoId } = await this.aplicarClasificacionDeRespuesta(tx, {
        prospectoId,
        respuestaId: row.respuestaId,
        clasificacion: input.clasificacion,
        comentario: input.comentario ?? null,
        contenido: null,
        fechaSeguimiento: input.fechaSeguimiento ?? null,
        origen: { descripcion: `clasificación manual, tarea ${id}`, executionId: null, usuarioId: user.id },
        guarda: "pendiente_o_ambigua"
      });

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
        despues: { clasificacion: input.clasificacion, respuesta_id: row.respuestaId, estado_prospecto: estadoProspecto, supresion_ids: supresionIds, tarea_seguimiento_id: tareaSeguimientoId }
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

    const { contactoId, empresaId } = input.prospecto_id
      ? await this.contextoDeProspecto(db, input.prospecto_id)
      : { contactoId: null, empresaId: null };

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

  // La empresa y el contacto de un prospecto, para ligar una tarea suya.
  private async contextoDeProspecto(db: DrizzleDb | DrizzleTx, prospectoId: number) {
    const [prospecto] = await db
      .select({ contactoId: contactos.id, empresaId: contactos.empresaId })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .where(eq(prospectos.id, prospectoId))
      .limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");
    return prospecto;
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
