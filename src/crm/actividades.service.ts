import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { actividades, auditoria, contactos, empresas, envios, oportunidades, prospectos, respuestas, tareas } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { ACCION_CAMBIO_ESTADO_POR_CLASIFICACION } from "../shared/clasificacion-respuesta.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CrearActividadInput, TimelineQuery } from "./dto/actividad.schema.js";

type TimelineEvento = {
  tipo: string;
  fecha: Date;
  responsable_id: number | null;
  canal: string | null;
  resultado: string | null;
  proxima_accion: string | null;
  detalle: Record<string, unknown>;
};

function actividadToEvento(row: typeof actividades.$inferSelect): TimelineEvento {
  return {
    tipo: row.tipo,
    fecha: row.ocurridaEn,
    responsable_id: row.responsableId,
    canal: row.tipo === "comentario" ? null : row.tipo,
    resultado: row.resultado,
    proxima_accion: row.proximaAccion,
    detalle: { actividad_id: row.id, comentario: row.comentario, contacto_id: row.contactoId, oportunidad_id: row.oportunidadId }
  };
}

function envioToEvento(row: typeof envios.$inferSelect): TimelineEvento {
  return {
    tipo: "correo_enviado",
    fecha: row.enviadoEn,
    responsable_id: null,
    canal: row.canal,
    resultado: null,
    proxima_accion: null,
    detalle: { envio_id: row.id, prospecto_id: row.prospectoId, numero_contacto: row.numeroContacto, ventana_estado: row.ventanaEstado }
  };
}

function respuestaToEvento(row: typeof respuestas.$inferSelect): TimelineEvento {
  return {
    tipo: "correo_recibido",
    fecha: row.recibidoEn,
    responsable_id: null,
    canal: row.canal,
    resultado: row.clasificacion,
    proxima_accion: null,
    detalle: { respuesta_id: row.id, prospecto_id: row.prospectoId, contenido: row.contenido, tardia: row.tardia }
  };
}

function tareaToEvento(row: typeof tareas.$inferSelect): TimelineEvento {
  return {
    tipo: "tarea",
    fecha: row.cerradaEn!,
    responsable_id: row.responsableId,
    canal: null,
    resultado: row.resultado,
    proxima_accion: null,
    detalle: { tarea_id: row.id, titulo: row.titulo, tipo_tarea: row.tipo, clasificacion: row.clasificacion }
  };
}

function auditoriaToEvento(row: typeof auditoria.$inferSelect): TimelineEvento {
  const despues = (row.despues ?? {}) as { estado?: string; motivo?: string };
  return {
    tipo: "cambio_estado_prospecto",
    fecha: row.creadoEn,
    responsable_id: row.usuarioId,
    canal: null,
    resultado: despues.estado ?? null,
    proxima_accion: null,
    detalle: { prospecto_id: row.entidadId, motivo: despues.motivo ?? null }
  };
}

@Injectable()
export class ActividadesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async crear(user: CurrentUser, input: CrearActividadInput) {
    // eq(activo, true) + scoping por propietario para agente agregados
    // (hallazgo de code review, 14-sep-2026): antes solo se comprobaba que
    // la empresa existiera -- un agente podía registrar actividades contra
    // una empresa ajena, y cualquiera podía registrarlas contra una
    // empresa ya desactivada (mismo bug que ya se había corregido en
    // oportunidades.service.ts/documentos.service.ts, pero se quedó sin
    // aplicar aquí).
    const [empresa] = await this.db.select({ id: empresas.id, propietarioId: empresas.propietarioId }).from(empresas).where(and(eq(empresas.id, input.empresaId), eq(empresas.activo, true))).limit(1);
    if (!empresa || (user.rol === "agente" && empresa.propietarioId !== user.id)) {
      throw new HttpError(404, "Empresa no encontrada");
    }

    if (input.contactoId) {
      const [contacto] = await this.db.select({ id: contactos.id }).from(contactos).where(and(eq(contactos.id, input.contactoId), eq(contactos.empresaId, input.empresaId))).limit(1);
      if (!contacto) throw new HttpError(404, "Contacto no encontrado en esa empresa");
    }
    if (input.oportunidadId) {
      const [oportunidad] = await this.db.select({ id: oportunidades.id }).from(oportunidades).where(and(eq(oportunidades.id, input.oportunidadId), eq(oportunidades.empresaId, input.empresaId))).limit(1);
      if (!oportunidad) throw new HttpError(404, "Oportunidad no encontrada en esa empresa");
    }

    const [result] = await this.db.insert(actividades).values({
      empresaId: input.empresaId,
      contactoId: input.contactoId ?? null,
      oportunidadId: input.oportunidadId ?? null,
      tipo: input.tipo,
      resultado: input.resultado ?? null,
      proximaAccion: input.proximaAccion ?? null,
      comentario: input.comentario ?? null,
      responsableId: user.id,
      ocurridaEn: input.ocurridaEn ?? new Date()
    });

    await this.db.insert(auditoria).values({
      usuarioId: user.id,
      entidad: "actividad",
      entidadId: result.insertId,
      accion: "crear",
      despues: { tipo: input.tipo, empresa_id: input.empresaId }
    });

    return { id: result.insertId };
  }

  // Línea de tiempo unificada (PLAN_CRM_DEFINITIVO.md #4): agrega varias
  // fuentes que ya existen, cada una con su propia forma de relacionarse
  // con la empresa/contacto:
  //   - actividades: columna empresa_id / contacto_id directa.
  //   - envios / respuestas / auditoria (cambios de estado de prospecto):
  //     se relacionan por prospecto_id, así que primero se resuelven los
  //     prospectos de la empresa (o del contacto, si se filtró por uno).
  //   - tareas: columna empresa_id / contacto_id directa (ya se resuelve
  //     así desde que se crean, sea por sesión o por automatización).
  // Si se filtra por oportunidad_id, SOLO actividades aplica: envios,
  // respuestas, tareas de automatización y los cambios de estado de
  // prospecto no tienen oportunidad_id -- casi siempre ocurrieron ANTES de
  // que la oportunidad existiera, así que no hay forma correcta de
  // atribuirlos a ella.
  async timeline(user: CurrentUser, query: TimelineQuery) {
    // eq(activo, true) agregado (hallazgo de code review, 14-sep-2026):
    // sin él, se podía consultar el timeline de una empresa ya
    // desactivada como si nada.
    const [empresa] = await this.db.select({ id: empresas.id, propietarioId: empresas.propietarioId }).from(empresas).where(and(eq(empresas.id, query.empresaId), eq(empresas.activo, true))).limit(1);
    if (!empresa || (user.rol === "agente" && empresa.propietarioId !== user.id)) {
      throw new HttpError(404, "Empresa no encontrada");
    }

    if (query.oportunidadId) {
      const filas = await this.db
        .select()
        .from(actividades)
        .where(and(eq(actividades.empresaId, query.empresaId), eq(actividades.oportunidadId, query.oportunidadId)))
        .orderBy(desc(actividades.ocurridaEn))
        .limit(query.limit);
      return { data: filas.map(actividadToEvento) };
    }

    const eventos: TimelineEvento[] = [];

    const actividadesCondition = query.contactoId
      ? and(eq(actividades.empresaId, query.empresaId), eq(actividades.contactoId, query.contactoId))
      : eq(actividades.empresaId, query.empresaId);
    const filasActividades = await this.db.select().from(actividades).where(actividadesCondition).orderBy(desc(actividades.ocurridaEn)).limit(query.limit);
    eventos.push(...filasActividades.map(actividadToEvento));

    const prospectosCondition = query.contactoId
      ? and(eq(contactos.empresaId, query.empresaId), eq(contactos.id, query.contactoId))
      : eq(contactos.empresaId, query.empresaId);
    const prospectosDeEmpresa = await this.db
      .select({ id: prospectos.id })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .where(prospectosCondition);
    const prospectoIds = prospectosDeEmpresa.map((p) => p.id);

    if (prospectoIds.length > 0) {
      const filasEnvios = await this.db.select().from(envios).where(inArray(envios.prospectoId, prospectoIds)).orderBy(desc(envios.enviadoEn)).limit(query.limit);
      eventos.push(...filasEnvios.map(envioToEvento));

      const filasRespuestas = await this.db.select().from(respuestas).where(inArray(respuestas.prospectoId, prospectoIds)).orderBy(desc(respuestas.recibidoEn)).limit(query.limit);
      eventos.push(...filasRespuestas.map(respuestaToEvento));

      const filasAuditoria = await this.db
        .select()
        .from(auditoria)
        // Cambios de estado de POST /automatizacion/prospectos/estado y los
        // que deja una clasificación (manual o de n8n).
        .where(and(eq(auditoria.entidad, "prospecto"), inArray(auditoria.accion, ["cambiar_estado_automatizacion", ACCION_CAMBIO_ESTADO_POR_CLASIFICACION]), inArray(auditoria.entidadId, prospectoIds)))
        .orderBy(desc(auditoria.creadoEn))
        .limit(query.limit);
      eventos.push(...filasAuditoria.map(auditoriaToEvento));
    }

    // Solo tareas cerradas: esto es un registro de lo que YA pasó, no una
    // bandeja de pendientes (para eso está GET /api/v1/tareas).
    const tareasCondition = query.contactoId
      ? and(eq(tareas.empresaId, query.empresaId), eq(tareas.contactoId, query.contactoId), isNotNull(tareas.cerradaEn))
      : and(eq(tareas.empresaId, query.empresaId), isNotNull(tareas.cerradaEn));
    const filasTareas = await this.db.select().from(tareas).where(tareasCondition).orderBy(desc(tareas.cerradaEn)).limit(query.limit);
    eventos.push(...filasTareas.map(tareaToEvento));

    eventos.sort((a, b) => b.fecha.getTime() - a.fecha.getTime());
    return { data: eventos.slice(0, query.limit) };
  }
}
