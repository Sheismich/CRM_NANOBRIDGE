import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, inArray, isNull, like, lt, ne, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, empresas, envios, mediosContacto, prospectos, respuestas, roles, tareas, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { aplicarClasificacionAlProspecto, type ClasificacionRespuesta, type OrigenClasificacion } from "../shared/clasificacion-respuesta.js";
import { recortarTexto } from "../shared/texto.js";
import { diaAnterior, diaSiguiente, fechaMx, finSiguienteDiaHabilMx, inicioDelDiaMxSql } from "../shared/dia-habil.js";
import { CODIGO_RESPUESTA_YA_CLASIFICADA } from "../shared/clasificaciones.js";
import { compactConditions, patronLike } from "../shared/drizzle-utils.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { ALERTAS_BATCH_SIZE } from "../shared/jobs.js";
import { CODIGO_PERSONA_EN_BAJA, personaEnBajaBloqueando } from "../shared/baja-prospecto.js";
import { darEmpresaAlAgente, responsableAsignable } from "../shared/empresa-de-agente.js";
import { adminsYSupervisores, enlaceTarea, lineaDeTarea, nombreEmpresa, notificar, responsableOEquipo } from "../notificaciones/notificar.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CrearTareaInput, ClasificarTareaInput } from "./dto/tarea.schema.js";
import type { TareaAutomatizacionInput } from "../automatizacion/dto/automatizacion.schema.js";

// La tarea que nace con un interesado; responder desde el CRM la busca por
// este título (etapa 3).
export const TITULO_TAREA_INTERESADO = "Contactar prospecto interesado";

export type ListTareasFilters = {
  estado?: "pendiente" | "en_progreso" | "cerrada" | "cancelada";
  prioridad?: "baja" | "media" | "alta" | "urgente";
  tipo?: "seguimiento" | "clasificacion" | "revision_documento" | "otro";
  responsableId?: number;
  sinAsignar?: boolean;
  q?: string;
  empresaId?: number;
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
  // La tarea de la cola que resolvió una persona; NULL si clasificó n8n.
  tareaClasificacionId: number | null;
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
    // "Corregir documento" (029): el documento rechazado.
    documento_id: row.documentoId,
    fecha_limite: row.fechaLimite,
    clasificacion: row.clasificacion,
    resultado: row.resultado,
    cerrada_en: row.cerradaEn,
    creada_por: row.creadaPor,
    creado_en: row.creadoEn,
    actualizado_en: row.actualizadoEn
  };
}

// Codes de los 409 al cerrar una tarea.
export const CODIGO_TAREA_CERRADA = "TAREA_CERRADA";
export const CODIGO_TAREA_REASIGNADA = "TAREA_REASIGNADA";

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
    if (user.rol === "agente") return { ...filters, responsableId: user.id, sinAsignar: undefined };
    return filters;
  }

  async list(user: CurrentUser, filters: ListTareasFilters, page: number, limit: number) {
    const scoped = this.scopedFilters(user, filters);
    const offset = (page - 1) * limit;

    const conditions = compactConditions([
      scoped.estado ? eq(tareas.estado, scoped.estado) : undefined,
      scoped.prioridad ? eq(tareas.prioridad, scoped.prioridad) : undefined,
      scoped.tipo ? eq(tareas.tipo, scoped.tipo) : undefined,
      scoped.responsableId ? eq(tareas.responsableId, scoped.responsableId) : undefined,
      scoped.sinAsignar ? isNull(tareas.responsableId) : undefined,
      scoped.empresaId ? eq(tareas.empresaId, scoped.empresaId) : undefined,
      scoped.q ? or(like(tareas.titulo, patronLike(scoped.q)), like(empresas.nombreLegal, patronLike(scoped.q)), like(empresas.nombreComercial, patronLike(scoped.q))) : undefined
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

  // Mi día (11-oct-2026): el anillo "1/3 HOY" = cerradas_hoy de
  // (cerradas_hoy + pendientes_hoy), y "3 completadas ayer". Siempre de
  // quien pregunta, sea del rol que sea; días en hora de México. Cancelar
  // no cuenta como completar.
  async conteosMiDia(user: CurrentUser) {
    const hoy = fechaMx(new Date());
    const inicioHoy = sql`${inicioDelDiaMxSql(hoy)}`;
    const inicioManana = sql`${inicioDelDiaMxSql(diaSiguiente(hoy))}`;
    const inicioAyer = sql`${inicioDelDiaMxSql(diaAnterior(hoy))}`;
    const abierta = sql`${tareas.estado} IN ('pendiente', 'en_progreso')`;
    const [fila] = await this.db
      .select({
        cerradasHoy: sql<number>`SUM(${tareas.estado} = 'cerrada' AND ${tareas.cerradaEn} >= ${inicioHoy} AND ${tareas.cerradaEn} < ${inicioManana})`,
        cerradasAyer: sql<number>`SUM(${tareas.estado} = 'cerrada' AND ${tareas.cerradaEn} >= ${inicioAyer} AND ${tareas.cerradaEn} < ${inicioHoy})`,
        pendientesHoy: sql<number>`SUM(${abierta} AND ${tareas.fechaLimite} >= ${inicioHoy} AND ${tareas.fechaLimite} < ${inicioManana})`,
        vencidas: sql<number>`SUM(${abierta} AND ${tareas.fechaLimite} < ${inicioHoy})`
      })
      .from(tareas)
      .where(eq(tareas.responsableId, user.id));
    return {
      cerradas_hoy: Number(fila?.cerradasHoy ?? 0),
      cerradas_ayer: Number(fila?.cerradasAyer ?? 0),
      pendientes_hoy: Number(fila?.pendientesHoy ?? 0),
      vencidas: Number(fila?.vencidas ?? 0)
    };
  }

  // C2 del plan de fixes (2-oct-2026): antes no se revisaba nada de esto.
  // Un agente siempre se crea la tarea a sí mismo (igual que las
  // oportunidades) y solo sobre sus empresas.
  async create(user: CurrentUser, input: CrearTareaInput) {
    const responsableId = user.rol === "agente" ? user.id : input.responsableId;
    const responsable = await responsableAsignable(this.db, responsableId);
    return this.db.transaction(async (tx) => {
      // Dentro de la transacción y con la persona bloqueada: si la baja se
      // confirmaba entre la revisión y el INSERT, el seguimiento nacía
      // después de que la baja cancelara los suyos y se quedaba abierto
      // (code review de verificación, 5-oct-2026).
      const { empresaId, contactoId } = await this.contextoDeTarea(tx, user, input);
      if (input.tipo === "seguimiento" && contactoId !== null && await personaEnBajaBloqueando(tx, contactoId)) {
        throw new HttpError(409, "La persona está dada de baja: no se le hacen seguimientos", CODIGO_PERSONA_EN_BAJA);
      }
      const [result] = await tx.insert(tareas).values({
        tipo: input.tipo,
        titulo: input.titulo,
        descripcion: input.descripcion ?? null,
        prioridad: input.prioridad,
        responsableId,
        empresaId,
        contactoId,
        prospectoId: input.prospectoId ?? null,
        fechaLimite: input.fechaLimite ?? null,
        creadaPor: user.id
      });
      // Asignar = dar dueño: ver shared/empresa-de-agente.ts.
      if (empresaId !== null) await darEmpresaAlAgente(tx, { empresaId, responsable, actor: user, origen: { tarea_id: result.insertId } });
      await this.avisarAsignacion(tx, user, { id: result.insertId, titulo: input.titulo, empresaId, responsableId });
      return result.insertId;
    });
  }

  // Aviso con correo a quien le dieron la tarea (si no se la dio a sí mismo).
  private async avisarAsignacion(tx: DrizzleTx, actor: CurrentUser, tarea: { id: number; titulo: string; empresaId: number | null; responsableId: number }) {
    await notificar(tx, [tarea.responsableId], {
      tipo: "tarea_asignada",
      titulo: `${actor.nombre} te asignó una tarea`,
      cuerpo: lineaDeTarea(tarea.titulo, await nombreEmpresa(tx, tarea.empresaId)),
      enlace: enlaceTarea(tarea.id),
      entidad: "tarea",
      entidadId: tarea.id,
      conCorreo: true
    }, actor.id);
  }

  // De qué empresa y contacto es la tarea. El contacto y el prospecto tienen
  // que ser de esa empresa; si solo llega el prospecto (o el contacto), la
  // tarea toma su contacto y su empresa, así sale en la ficha. Un agente
  // solo cuelga tareas de empresas suyas (lo ajeno, 404).
  private async contextoDeTarea(db: DrizzleDb | DrizzleTx, user: CurrentUser, input: CrearTareaInput) {
    let empresaId = input.empresaId ?? null;
    let contactoId = input.contactoId ?? null;

    if (input.prospectoId) {
      const [p] = await db
        .select({ contactoId: prospectos.contactoId, empresaId: contactos.empresaId, activo: contactos.activo })
        .from(prospectos)
        .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
        .where(eq(prospectos.id, input.prospectoId))
        .limit(1);
      if (!p || !p.activo || (empresaId !== null && p.empresaId !== empresaId)) throw new HttpError(404, "Prospecto no encontrado en esa empresa");
      if (contactoId !== null && contactoId !== p.contactoId) throw new HttpError(400, "El prospecto no es de ese contacto");
      contactoId = p.contactoId;
      empresaId = p.empresaId;
    } else if (contactoId !== null) {
      const [c] = await db.select({ empresaId: contactos.empresaId, activo: contactos.activo }).from(contactos).where(eq(contactos.id, contactoId)).limit(1);
      if (!c || !c.activo || (empresaId !== null && c.empresaId !== empresaId)) throw new HttpError(404, "Contacto no encontrado en esa empresa");
      empresaId = c.empresaId;
    }

    if (empresaId !== null) {
      const [e] = await db.select({ propietarioId: empresas.propietarioId }).from(empresas).where(and(eq(empresas.id, empresaId), eq(empresas.activo, true))).limit(1);
      if (!e || (user.rol === "agente" && e.propietarioId !== user.id)) throw new HttpError(404, "Empresa no encontrada");
    }
    return { empresaId, contactoId };
  }

  // El detalle trae su contexto (panel de detalle de Tareas, 9-oct-2026):
  // de qué empresa y persona es, quién la tiene y, si la originó una
  // respuesta, qué contestó la persona -- sin pedir cada cosa aparte.
  // Mi día (11-oct-2026) agrega la campaña del prospecto y un teléfono
  // para marcar (ver telefonoDeContacto).
  async get(user: CurrentUser, id: number) {
    const [r] = await this.db
      .select({
        tarea: tareas,
        empresaNombre: sql<string | null>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
        contactoNombre: contactos.nombre,
        contactoPuesto: contactos.puesto,
        campanaNombre: campanas.nombre,
        responsableNombre: usuarios.nombre,
        respuestaContenido: respuestas.contenido,
        respuestaRecibidoEn: respuestas.recibidoEn,
        respuestaClasificacion: respuestas.clasificacion,
        respuestaClasificacionSugerida: respuestas.clasificacionSugerida,
        respuestaConfianzaSugerida: respuestas.confianzaSugerida,
        respuestaMotivoSugerencia: respuestas.motivoSugerencia
      })
      .from(tareas)
      .leftJoin(empresas, eq(empresas.id, tareas.empresaId))
      .leftJoin(contactos, eq(contactos.id, tareas.contactoId))
      .leftJoin(usuarios, eq(usuarios.id, tareas.responsableId))
      .leftJoin(respuestas, eq(respuestas.id, tareas.respuestaId))
      .leftJoin(prospectos, eq(prospectos.id, tareas.prospectoId))
      .leftJoin(campanas, eq(campanas.id, prospectos.campanaId))
      .where(eq(tareas.id, id))
      .limit(1);
    if (!r || (user.rol === "agente" && r.tarea.responsableId !== user.id)) {
      throw new HttpError(404, "Tarea no encontrada");
    }
    return {
      ...toRow(r.tarea),
      empresa_nombre: r.empresaNombre,
      contacto_nombre: r.contactoNombre,
      contacto_puesto: r.contactoPuesto,
      contacto_telefono: r.tarea.contactoId ? await this.telefonoDeContacto(r.tarea.contactoId) : null,
      campana_nombre: r.campanaNombre,
      responsable_nombre: r.responsableNombre,
      respuesta: r.tarea.respuestaId
        ? {
            id: r.tarea.respuestaId,
            contenido: r.respuestaContenido,
            recibido_en: r.respuestaRecibidoEn,
            clasificacion: r.respuestaClasificacion,
            // Lo que propuso la IA de n8n y por qué (Mi día, 11-oct-2026);
            // null si no la vio. La decisión sigue siendo `clasificacion`.
            clasificacion_sugerida: r.respuestaClasificacionSugerida,
            confianza_sugerida: r.respuestaConfianzaSugerida,
            motivo_sugerencia: r.respuestaMotivoSugerencia
          }
        : null
    };
  }

  // El teléfono que muestra Mi día junto a los botones: solo medios activos
  // (un "no_contactar" no se ofrece para marcar); gana el principal, luego
  // teléfono antes que WhatsApp, luego el más antiguo.
  private async telefonoDeContacto(contactoId: number) {
    const [m] = await this.db
      .select({ tipo: mediosContacto.tipo, valor: mediosContacto.valor })
      .from(mediosContacto)
      .where(and(eq(mediosContacto.contactoId, contactoId), inArray(mediosContacto.tipo, ["telefono", "whatsapp"]), eq(mediosContacto.estadoContacto, "activo")))
      .orderBy(desc(mediosContacto.esPrincipal), sql`${mediosContacto.tipo} = 'telefono' DESC`, mediosContacto.id)
      .limit(1);
    return m ?? null;
  }

  // Historial de una tarea (panel de detalle, 9-oct-2026): lo que le pasó a
  // la tarea (creada, asignada, cerrada) junto con la prospección de su
  // prospecto (correos que salieron y respuestas que llegaron), lo más
  // nuevo primero. Mismo permiso que el detalle: un agente solo la suya.
  // Con la misma fecha (DATETIME es al segundo) va primero lo de la tarea.
  async historial(user: CurrentUser, id: number) {
    const tarea = await this.get(user, id);
    const orden = { cerrada: 0, reprogramada: 1, asignada: 2, creada: 3, respuesta: 4, envio: 5 } as const;

    const movimientos = await this.db
      .select({ accion: auditoria.accion, fecha: auditoria.creadoEn, usuarioNombre: usuarios.nombre, despues: auditoria.despues })
      .from(auditoria)
      .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
      .where(and(eq(auditoria.entidad, "tarea"), eq(auditoria.entidadId, id), inArray(auditoria.accion, ["asignar", "cerrar", "reprogramar"])));

    const eventos: { tipo: keyof typeof orden; fecha: Date; [k: string]: unknown }[] = [
      { tipo: "creada", fecha: tarea.creado_en },
      ...movimientos.map((m) => {
        const base = { fecha: m.fecha, usuario_nombre: m.usuarioNombre };
        const despues = m.despues as { responsable_id?: number; resultado?: string; fecha_limite?: string } | null;
        if (m.accion === "asignar") return { ...base, tipo: "asignada" as const, responsable_id: despues?.responsable_id ?? null };
        if (m.accion === "reprogramar") return { ...base, tipo: "reprogramada" as const, fecha_limite: despues?.fecha_limite ?? null };
        return { ...base, tipo: "cerrada" as const, resultado: despues?.resultado ?? null };
      })
    ];

    if (tarea.prospecto_id) {
      const [filasEnvios, filasRespuestas] = await Promise.all([
        this.db.select({ fecha: envios.enviadoEn, numeroContacto: envios.numeroContacto, canal: envios.canal }).from(envios).where(eq(envios.prospectoId, tarea.prospecto_id)),
        this.db.select({ fecha: respuestas.recibidoEn, clasificacion: respuestas.clasificacion, contenido: respuestas.contenido }).from(respuestas).where(eq(respuestas.prospectoId, tarea.prospecto_id))
      ]);
      eventos.push(
        ...filasEnvios.map((e) => ({ tipo: "envio" as const, fecha: e.fecha, numero_contacto: e.numeroContacto, canal: e.canal })),
        ...filasRespuestas.map((r) => ({ tipo: "respuesta" as const, fecha: r.fecha, clasificacion: r.clasificacion, contenido: r.contenido }))
      );
    }

    return eventos.sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || orden[a.tipo] - orden[b.tipo]);
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
    const responsable = await responsableAsignable(this.db, responsableId);

    // Ya es suya: la tarea no cambia, pero la empresa sí se revisa. Antes
    // salía aquí y no había forma de darle la empresa a un agente que ya
    // tenía la tarea desde antes de C1 (code review, 5-oct-2026).
    if (row.responsableId === responsableId) {
      if (row.empresaId) {
        const empresaId = row.empresaId;
        await this.db.transaction((tx) => darEmpresaAlAgente(tx, { empresaId, responsable, actor: user, origen: { tarea_id: id } }));
      }
      return;
    }

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
      // Asignar = dar dueño: ver shared/empresa-de-agente.ts.
      if (row.empresaId) await darEmpresaAlAgente(tx, { empresaId: row.empresaId, responsable, actor: user, origen: { tarea_id: id } });
      await this.avisarAsignacion(tx, user, { id, titulo: row.titulo, empresaId: row.empresaId, responsableId });
    });
  }

  // "Reprogramar" de Mi día (13-oct-2026): nueva fecha límite para una
  // tarea abierta. alertado_en vuelve a null para que, si la fecha nueva
  // también se vence, el aviso de SLA salga otra vez. Misma revalidación
  // dentro del UPDATE que cerrar(): abierta y, para un agente, suya.
  async reprogramar(user: CurrentUser, id: number, fechaLimite: Date) {
    const row = await this.findAssignable(user, id);
    await this.db.transaction(async (tx) => {
      const [result] = await tx.update(tareas).set({ fechaLimite, alertadoEn: null }).where(and(
        eq(tareas.id, id),
        sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`,
        user.rol === "agente" ? eq(tareas.responsableId, user.id) : undefined
      ));
      if (result.affectedRows === 0) throw new HttpError(409, "La tarea ya está cerrada o ya no es tuya");
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "tarea",
        entidadId: id,
        accion: "reprogramar",
        antes: { fecha_limite: row.fechaLimite },
        despues: { fecha_limite: fechaLimite }
      });
    });
  }

  // Cerrar una tarea genera un evento en eventos_pendientes (patrón outbox
  // obligatorio, PLAN_CRM_DEFINITIVO.md #5): nunca se llama a n8n desde aquí
  // directamente, solo se encola el evento en la misma transacción.
  async cerrar(user: CurrentUser, id: number, resultado: string) {
    const row = await this.findAssignable(user, id, CODIGO_TAREA_CERRADA);
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
      }).where(and(
        eq(tareas.id, id),
        sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`,
        // Un agente solo cierra la que sigue siendo suya: si se la
        // reasignaron entre la lectura y este UPDATE, no la cierra (C2).
        user.rol === "agente" ? eq(tareas.responsableId, user.id) : undefined
      ));
      if (result.affectedRows === 0) {
        // Dos causas distintas que la pantalla explica distinto (code review,
        // 5-oct-2026). Lectura con bloqueo: lo último confirmado.
        const [actual] = await tx.select({ estado: tareas.estado }).from(tareas).where(eq(tareas.id, id)).limit(1).for("share");
        if (actual && actual.estado !== "cerrada" && actual.estado !== "cancelada") {
          throw new HttpError(409, "Te reasignaron esta tarea mientras la cerrabas; ya no es tuya", CODIGO_TAREA_REASIGNADA);
        }
        throw new HttpError(409, "La tarea ya está cerrada", CODIGO_TAREA_CERRADA);
      }

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
        respuestaClasificacion: respuestas.clasificacion,
        respuestaClasificacionSugerida: respuestas.clasificacionSugerida,
        respuestaConfianzaSugerida: respuestas.confianzaSugerida,
        respuestaMotivoSugerencia: respuestas.motivoSugerencia,
        respuestaRemitente: respuestas.remitente
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
          ? {
              id: r.tarea.respuestaId,
              canal: r.respuestaCanal,
              contenido: r.respuestaContenido,
              recibido_en: r.respuestaRecibidoEn,
              // Lo que propuso la IA (modo sugerencia) o, si no hay, lo que
              // decidió n8n (normalmente "ambigua"): la pantalla ya pinta
              // este campo como "n8n: …".
              clasificacion_sugerida: r.respuestaClasificacionSugerida ?? r.respuestaClasificacion,
              confianza_sugerida: r.respuestaConfianzaSugerida,
              motivo_sugerencia: r.respuestaMotivoSugerencia,
              // Quién la mandó (puede no ser el prospecto si reenvió el correo).
              remitente: r.respuestaRemitente
            }
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

    // enBaja: "la baja manda" (ver aplicarClasificacionAlProspecto). La
    // respuesta queda clasificada, pero a quien pidió la baja no se le crean
    // tareas de seguimiento ni de cola.
    const { estadoProspecto, supresionIds, enBaja } = await aplicarClasificacionAlProspecto(tx, input.prospectoId, input.clasificacion, input.origen);

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
      tareaId = abierta?.id ?? (enBaja ? null : (await this.createFromAutomation({
        execution_id: `resp-clasif-${input.origen.executionId}`,
        prospecto_id: input.prospectoId,
        respuesta_id: input.respuestaId ?? undefined,
        tipo: "clasificacion",
        titulo: "Clasificar respuesta ambigua",
        descripcion: input.comentario ?? input.contenido ?? undefined,
        prioridad: "media"
      }, tx)).id);
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

    if (input.clasificacion === "interesado" && !enBaja) {
      tareaId = await this.crearTareaDeInteresado(tx, input);
    }

    if (input.clasificacion === "reagendar" && !enBaja) {
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

  // Un "interesado" solo cambiaba el estado del prospecto y nadie se
  // enteraba. PLAN_CRM_DEFINITIVO.md: "Las oportunidades se crean cuando un
  // prospecto interesado es tomado por un asesor", así que no se crea la
  // oportunidad: queda una tarea sin asignar, prioridad alta, para que un
  // supervisor la reparta (PATCH /tareas/:id/asignar). Con fecha límite al
  // fin del siguiente día hábil, la alerta diaria de SLA avisa si nadie la
  // tomó (decisión del 30-sep-2026). Idempotente: una por respuesta (o por
  // tarea de la cola, si la creó una persona sin respuesta).
  private async crearTareaDeInteresado(tx: DrizzleTx, input: ClasificacionDeRespuesta) {
    let contenido = input.contenido;
    if (contenido === null && input.respuestaId !== null) {
      const [respuesta] = await tx.select({ contenido: respuestas.contenido }).from(respuestas).where(eq(respuestas.id, input.respuestaId)).limit(1);
      contenido = respuesta?.contenido ?? null;
    }

    // P3.9 (etapa 3, 20-oct-2026): si el prospecto ya tiene una abierta, no
    // nace otra; la respuesta nueva se le agrega y se avisa a quien la tiene
    // (o a quienes reparten, si está sin asignar).
    const [abierta] = await tx
      .select({ id: tareas.id, descripcion: tareas.descripcion, responsableId: tareas.responsableId, respuestaId: tareas.respuestaId })
      .from(tareas)
      .where(and(eq(tareas.prospectoId, input.prospectoId), eq(tareas.titulo, TITULO_TAREA_INTERESADO), sql`${tareas.estado} NOT IN ('cerrada', 'cancelada')`))
      .orderBy(tareas.id)
      .limit(1)
      .for("update");
    if (abierta && abierta.respuestaId !== input.respuestaId) {
      const agregado = [`Otra respuesta, clasificada como interesado (${input.origen.descripcion}):`, input.comentario, contenido].filter((linea) => linea).join("\n\n");
      await tx.update(tareas).set({ descripcion: [abierta.descripcion, agregado].filter(Boolean).join("\n\n---\n\n") }).where(eq(tareas.id, abierta.id));
      const { ids, delEquipo } = await responsableOEquipo(tx, abierta.responsableId);
      const empresa = await this.empresaDelProspecto(tx, input.prospectoId);
      await notificar(tx, ids, {
        tipo: "interesado",
        titulo: `Volvió a contestar: ${empresa ?? "prospecto interesado"}`,
        cuerpo: contenido ? recortarTexto(contenido, 300) : null,
        enlace: enlaceTarea(abierta.id, delEquipo ? "sin_asignar" : undefined),
        entidad: "tarea",
        entidadId: abierta.id,
        conCorreo: true
      }, input.origen.usuarioId);
      return abierta.id;
    }

    const tarea = await this.createFromAutomation({
      execution_id: input.respuestaId !== null ? `interesado-resp-${input.respuestaId}` : `interesado-tarea-${input.tareaClasificacionId}`,
      prospecto_id: input.prospectoId,
      respuesta_id: input.respuestaId ?? undefined,
      tipo: "seguimiento",
      titulo: TITULO_TAREA_INTERESADO,
      descripcion: [`Clasificada como interesado (${input.origen.descripcion}).`, input.comentario, contenido].filter((linea) => linea).join("\n\n"),
      prioridad: "alta",
      fecha_limite: finSiguienteDiaHabilMx(new Date()).toISOString()
    }, tx);
    if (tarea.id !== null && !tarea.ya_existia) await this.avisarInteresado(tx, tarea.id, input, contenido);
    return tarea.id;
  }

  private async empresaDelProspecto(tx: DrizzleTx, prospectoId: number) {
    const [fila] = await tx
      .select({ empresa: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})` })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(eq(prospectos.id, prospectoId))
      .limit(1);
    return fila?.empresa ?? null;
  }

  // La tarea nace sin asignar y un agente no ve las tareas sin asignar: el
  // aviso va a quienes la reparten (admins y supervisores). Si la empresa
  // ya es de un agente, a él también, con la liga a la ficha (decisión del
  // 19-oct-2026). Con correo; nunca a quien lo clasificó.
  private async avisarInteresado(tx: DrizzleTx, tareaId: number, input: ClasificacionDeRespuesta, contenido: string | null) {
    const [contexto] = await tx
      .select({
        empresaId: empresas.id,
        empresa: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
        contacto: contactos.nombre,
        propietarioId: empresas.propietarioId,
        rolPropietario: roles.clave
      })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .leftJoin(usuarios, eq(usuarios.id, empresas.propietarioId))
      .leftJoin(roles, eq(roles.id, usuarios.rolId))
      .where(eq(prospectos.id, input.prospectoId))
      .limit(1);
    if (!contexto) return;

    const aviso = {
      tipo: "interesado" as const,
      titulo: `Prospecto interesado: ${contexto.empresa}`,
      cuerpo: [`${contexto.contacto} contestó que le interesa.`, contenido ? recortarTexto(contenido, 300) : null].filter(Boolean).join("\n"),
      entidad: "tarea",
      entidadId: tareaId,
      conCorreo: true
    };
    const actorId = input.origen.usuarioId;
    await notificar(tx, await adminsYSupervisores(tx), { ...aviso, enlace: enlaceTarea(tareaId, "sin_asignar") }, actorId);
    if (contexto.propietarioId !== null && contexto.rolPropietario === "agente") {
      await notificar(tx, [contexto.propietarioId], { ...aviso, enlace: `/empresas/${contexto.empresaId}` }, actorId);
    }
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
        guarda: "pendiente_o_ambigua",
        tareaClasificacionId: id
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
  async createFromAutomation(input: TareaAutomatizacionInput & { respuesta_id?: number }, db: DrizzleDb | DrizzleTx = this.db): Promise<{ id: number; ya_existia: boolean } | { id: null; ya_existia: false; omitida: "prospecto_en_baja" }> {
    // La revisión de baja bloquea a la persona hasta el fin de la
    // transacción: sin una de quien llama, se abre una propia.
    if (db === this.db) return this.db.transaction((tx) => this.createFromAutomation(input, tx));
    const tx = db as DrizzleTx;

    const [existing] = await db.select({ id: tareas.id }).from(tareas).where(eq(tareas.executionId, input.execution_id)).limit(1);
    if (existing) return { id: existing.id, ya_existia: true as const };

    const { contactoId, empresaId } = input.prospecto_id
      ? await this.contextoDeProspecto(db, input.prospecto_id)
      : { contactoId: null, empresaId: null };

    // La baja no se deshace (A3, 2-oct-2026): a quien pidió la baja no se le
    // crean tareas de seguimiento (contactarlo). Las de la cola de
    // clasificación sí, para que alguien lea lo que contestó. No es error:
    // id null con el motivo.
    if (input.tipo === "seguimiento" && contactoId !== null && await personaEnBajaBloqueando(tx, contactoId)) {
      return { id: null, ya_existia: false as const, omitida: "prospecto_en_baja" as const };
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
      // Solo campanita: el correo de "llegó una respuesta" ya lo manda PT2
      // al supervisor (decisión del 19-oct-2026).
      if (input.tipo === "clasificacion") {
        await notificar(tx, await adminsYSupervisores(tx), {
          tipo: "respuesta_por_clasificar",
          titulo: "Nueva respuesta por clasificar",
          cuerpo: (await nombreEmpresa(tx, empresaId)) ?? input.titulo,
          enlace: "/tareas?tab=cola",
          entidad: "tarea",
          entidadId: result.insertId,
          conCorreo: false
        });
      }
      return { id: result.insertId, ya_existia: false as const };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        // Lectura con bloqueo: ve la fila que la otra llamada confirmó; la
        // foto de esta transacción es de antes y no la vería.
        const [retry] = await db.select({ id: tareas.id }).from(tareas).where(eq(tareas.executionId, input.execution_id)).limit(1).for("share");
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
  // Lo dispara n8n cada día (POST /automatizacion/jobs/..., B5 del plan de
  // fixes, 2-oct-2026): con @Interval(24h) nunca corría en Cloud Run.
  async alertarTareasSlaVencidas() {
    const candidatas = await this.db
      .select({ id: tareas.id, tipo: tareas.tipo, titulo: tareas.titulo, empresaId: tareas.empresaId, responsableId: tareas.responsableId, fechaLimite: tareas.fechaLimite })
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
        // Al responsable; sin responsable (o si ya no está), a quienes
        // reparten. Con correo (etapa 2 de las mejoras, 19-oct-2026).
        const { ids, delEquipo } = await responsableOEquipo(tx, tarea.responsableId);
        await notificar(tx, ids, {
          tipo: "tarea_vencida",
          titulo: `Se venció una tarea: ${tarea.titulo}`,
          cuerpo: lineaDeTarea(tarea.titulo, await nombreEmpresa(tx, tarea.empresaId)),
          enlace: enlaceTarea(tarea.id, !delEquipo ? undefined : tarea.responsableId === null ? "sin_asignar" : "todas"),
          entidad: "tarea",
          entidadId: tarea.id,
          conCorreo: true
        });
        return true;
      });
      if (encolado) alertadas++;
    }

    if (alertadas > 0) this.logger.log(`${alertadas} tarea(s) con SLA vencido alertada(s)`);
    return alertadas;
  }
}
