import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, catalogoEtapaEmbudo, catalogoMotivoPerdida, contactos, empresas, historialEtapaOportunidad, oportunidades, prospectos } from "../database/schema.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { HttpError } from "../shared/http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CambiarEtapaInput, CrearOportunidadInput, ListOportunidadesQuery, ReabrirOportunidadInput } from "./dto/oportunidad.schema.js";

function toRow(row: typeof oportunidades.$inferSelect & { etapaClave: string; etapaNombre: string; probabilidad: number }) {
  return {
    id: row.id,
    empresa_id: row.empresaId,
    contacto_id: row.contactoId,
    prospecto_id: row.prospectoId,
    titulo: row.titulo,
    etapa_clave: row.etapaClave,
    etapa_nombre: row.etapaNombre,
    probabilidad: row.probabilidad,
    responsable_id: row.responsableId,
    valor_estimado: row.valorEstimado,
    fecha_cierre_estimada: row.fechaCierreEstimada,
    motivo_perdida_id: row.motivoPerdidaId,
    motivo_perdida_detalle: row.motivoPerdidaDetalle,
    cerrada: row.cerrada,
    creado_en: row.creadoEn,
    actualizado_en: row.actualizadoEn
  };
}

@Injectable()
export class OportunidadesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // "El agente ve sus empresas, contactos, tareas y oportunidades
  // asignadas" (PLAN_CRM_DEFINITIVO.md) — mismo criterio de scoping que
  // TareasService: por responsable, no por dueño de la empresa.
  private scopedResponsable(user: CurrentUser, responsableId?: number) {
    if (user.rol === "agente") return user.id;
    return responsableId;
  }

  async catalogos() {
    const etapas = await this.db
      .select({ clave: catalogoEtapaEmbudo.clave, nombre: catalogoEtapaEmbudo.nombre, probabilidad: catalogoEtapaEmbudo.probabilidad, orden: catalogoEtapaEmbudo.orden, es_cierre: catalogoEtapaEmbudo.esCierre, es_ganada: catalogoEtapaEmbudo.esGanada })
      .from(catalogoEtapaEmbudo)
      .orderBy(catalogoEtapaEmbudo.orden);
    const motivosPerdida = await this.db
      .select({ clave: catalogoMotivoPerdida.clave, nombre: catalogoMotivoPerdida.nombre, requiere_explicacion: catalogoMotivoPerdida.requiereExplicacion })
      .from(catalogoMotivoPerdida);
    return { etapas, motivos_perdida: motivosPerdida };
  }

  async list(user: CurrentUser, query: ListOportunidadesQuery) {
    const offset = (query.page - 1) * query.limit;
    const responsableId = this.scopedResponsable(user, query.responsableId);

    const conditions = compactConditions([
      responsableId ? eq(oportunidades.responsableId, responsableId) : undefined,
      // Sin validar que la empresa exista/esté activa a propósito: a
      // diferencia de documentos/cotizaciones (que SÍ cuelgan de la
      // propiedad de la empresa), el scoping de este módulo es siempre
      // por responsable_id -- ver scopedResponsable() arriba. Un
      // empresaId inexistente aquí simplemente no hace match con ninguna
      // fila, mismo comportamiento que cualquier otra combinación de
      // filtros sin resultados.
      query.empresaId ? eq(oportunidades.empresaId, query.empresaId) : undefined,
      query.cerrada !== undefined ? eq(oportunidades.cerrada, query.cerrada) : undefined,
      query.etapaClave ? eq(catalogoEtapaEmbudo.clave, query.etapaClave) : undefined
    ]);

    const rows = await this.db
      .select({
        oportunidad: oportunidades,
        etapaClave: catalogoEtapaEmbudo.clave,
        etapaNombre: catalogoEtapaEmbudo.nombre,
        probabilidad: catalogoEtapaEmbudo.probabilidad
      })
      .from(oportunidades)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(oportunidades.actualizadoEn))
      .limit(query.limit)
      .offset(offset);

    return { page: query.page, limit: query.limit, data: rows.map((row) => toRow({ ...row.oportunidad, etapaClave: row.etapaClave, etapaNombre: row.etapaNombre, probabilidad: row.probabilidad })) };
  }

  private async validarContacto(empresaId: number, contactoId: number) {
    const [row] = await this.db.select({ id: contactos.id }).from(contactos).where(and(eq(contactos.id, contactoId), eq(contactos.empresaId, empresaId), eq(contactos.activo, true))).limit(1);
    if (!row) throw new HttpError(404, "Contacto no encontrado en esa empresa");
  }

  private async validarProspecto(empresaId: number, prospectoId: number) {
    // eq(contactos.activo, true) agregado (hallazgo de code review,
    // 14-sep-2026): sin él, un prospecto cuyo contacto ya se desactivó
    // (EmpresasService.deactivateContact) seguía pudiendo vincularse a una
    // oportunidad nueva -- validarContacto(), agregado en este mismo
    // cambio para el path directo por contactoId, sí lo exigía; este path
    // por prospectoId se quedó sin la misma protección.
    const [row] = await this.db
      .select({ id: prospectos.id })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .where(and(eq(prospectos.id, prospectoId), eq(contactos.empresaId, empresaId), eq(contactos.activo, true)))
      .limit(1);
    if (!row) throw new HttpError(404, "Prospecto no encontrado en esa empresa");
  }

  private async findScoped(user: CurrentUser, id: number) {
    const [row] = await this.db
      .select({
        oportunidad: oportunidades,
        etapaClave: catalogoEtapaEmbudo.clave,
        etapaNombre: catalogoEtapaEmbudo.nombre,
        probabilidad: catalogoEtapaEmbudo.probabilidad
      })
      .from(oportunidades)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(eq(oportunidades.id, id))
      .limit(1);
    if (!row || (user.rol === "agente" && row.oportunidad.responsableId !== user.id)) {
      throw new HttpError(404, "Oportunidad no encontrada");
    }
    return row;
  }

  async get(user: CurrentUser, id: number) {
    const row = await this.findScoped(user, id);
    const historial = await this.db
      .select({
        id: historialEtapaOportunidad.id,
        etapaId: historialEtapaOportunidad.etapaId,
        etapaClave: catalogoEtapaEmbudo.clave,
        etapaNombre: catalogoEtapaEmbudo.nombre,
        usuarioId: historialEtapaOportunidad.usuarioId,
        motivoPerdidaId: historialEtapaOportunidad.motivoPerdidaId,
        comentario: historialEtapaOportunidad.comentario,
        creadoEn: historialEtapaOportunidad.creadoEn
      })
      .from(historialEtapaOportunidad)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, historialEtapaOportunidad.etapaId))
      .where(eq(historialEtapaOportunidad.oportunidadId, id))
      .orderBy(historialEtapaOportunidad.creadoEn);

    return {
      ...toRow({ ...row.oportunidad, etapaClave: row.etapaClave, etapaNombre: row.etapaNombre, probabilidad: row.probabilidad }),
      historial: historial.map((h) => ({
        id: h.id,
        etapa_clave: h.etapaClave,
        etapa_nombre: h.etapaNombre,
        usuario_id: h.usuarioId,
        motivo_perdida_id: h.motivoPerdidaId,
        comentario: h.comentario,
        creado_en: h.creadoEn
      }))
    };
  }

  async create(user: CurrentUser, input: CrearOportunidadInput) {
    // eq(empresas.activo, true) agregado (hallazgo de code review,
    // 14-sep-2026): sin él, se podía crear una oportunidad nueva contra
    // una empresa ya desactivada (EmpresasService.deactivate), quedando
    // "huérfana" de cualquier registro de empresa visible.
    const [empresa] = await this.db.select({ id: empresas.id }).from(empresas).where(and(eq(empresas.id, input.empresaId), eq(empresas.activo, true))).limit(1);
    if (!empresa) throw new HttpError(404, "Empresa no encontrada");

    const [etapaInicial] = await this.db.select({ id: catalogoEtapaEmbudo.id }).from(catalogoEtapaEmbudo).where(eq(catalogoEtapaEmbudo.clave, "calificada")).limit(1);
    if (!etapaInicial) throw new HttpError(500, "Catálogo de etapas sin sembrar");

    // Antes contactoId/prospectoId se insertaban tal cual venían del
    // input, sin comprobar que pertenecieran a empresaId -- se podía
    // vincular a una oportunidad un contacto (o el prospecto de un
    // contacto) de OTRA empresa (hallazgo de code review, 14-sep-2026),
    // mismo tipo de validación que ya hace CotizacionesService.
    // validarContacto para cotizaciones.
    await Promise.all([
      input.contactoId ? this.validarContacto(input.empresaId, input.contactoId) : Promise.resolve(),
      input.prospectoId ? this.validarProspecto(input.empresaId, input.prospectoId) : Promise.resolve()
    ]);

    // Un agente solo puede tomar la oportunidad para sí mismo, igual que
    // TareasService.scopedFilters restringe la bandeja por responsable.
    const responsableId = user.rol === "agente" ? user.id : (input.responsableId ?? user.id);

    return this.db.transaction(async (tx) => {
      const [created] = await tx.insert(oportunidades).values({
        empresaId: input.empresaId,
        contactoId: input.contactoId ?? null,
        prospectoId: input.prospectoId ?? null,
        titulo: input.titulo,
        etapaId: etapaInicial.id,
        responsableId,
        valorEstimado: input.valorEstimado !== undefined ? input.valorEstimado.toFixed(2) : null,
        fechaCierreEstimada: input.fechaCierreEstimada ?? null
      });

      await tx.insert(historialEtapaOportunidad).values({
        oportunidadId: created.insertId,
        etapaId: etapaInicial.id,
        usuarioId: user.id,
        comentario: "Oportunidad creada"
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "oportunidad",
        entidadId: created.insertId,
        accion: "crear",
        despues: { empresa_id: input.empresaId, titulo: input.titulo, responsable_id: responsableId }
      });

      return created.insertId;
    });
  }

  async cambiarEtapa(user: CurrentUser, id: number, input: CambiarEtapaInput) {
    const actual = await this.findScoped(user, id);
    if (actual.oportunidad.cerrada) throw new HttpError(409, "La oportunidad ya está cerrada; reábrela primero");

    const [nuevaEtapa] = await this.db.select().from(catalogoEtapaEmbudo).where(eq(catalogoEtapaEmbudo.clave, input.etapaClave)).limit(1);
    if (!nuevaEtapa) throw new HttpError(404, "Etapa no encontrada");

    let motivoPerdidaId: number | null = null;
    if (nuevaEtapa.clave === "perdida" && input.motivoPerdidaClave) {
      const [motivo] = await this.db.select({ id: catalogoMotivoPerdida.id }).from(catalogoMotivoPerdida).where(eq(catalogoMotivoPerdida.clave, input.motivoPerdidaClave)).limit(1);
      if (!motivo) throw new HttpError(404, "Motivo de pérdida no encontrado");
      motivoPerdidaId = motivo.id;
    }

    await this.db.transaction(async (tx) => {
      // eq(cerrada, false) + affectedRows agregados (hallazgo de code
      // review, 14-sep-2026): sin esto, dos PATCH .../etapa concurrentes
      // sobre la misma oportunidad abierta (ej. uno a "ganada" y otro a
      // "perdida") pasaban ambos el guard de lectura de arriba y los dos
      // escribían -- el último en llegar ganaba en silencio, sin ningún
      // 409, con dos filas de historial/auditoría contradictorias. Mismo
      // patrón CAS que ya usan cotizaciones/tareas/empresas.
      const [result] = await tx.update(oportunidades).set({
        etapaId: nuevaEtapa.id,
        cerrada: nuevaEtapa.esCierre,
        motivoPerdidaId: nuevaEtapa.clave === "perdida" ? motivoPerdidaId : null,
        motivoPerdidaDetalle: nuevaEtapa.clave === "perdida" ? (input.motivoPerdidaDetalle ?? null) : null
      }).where(and(eq(oportunidades.id, id), eq(oportunidades.cerrada, false)));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "La oportunidad cambió de estado, vuelve a intentarlo");
      }

      await tx.insert(historialEtapaOportunidad).values({
        oportunidadId: id,
        etapaId: nuevaEtapa.id,
        usuarioId: user.id,
        motivoPerdidaId: nuevaEtapa.clave === "perdida" ? motivoPerdidaId : null,
        comentario: input.comentario ?? null
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "oportunidad",
        entidadId: id,
        accion: "cambiar_etapa",
        antes: { etapa_clave: actual.etapaClave },
        despues: { etapa_clave: nuevaEtapa.clave, motivo_perdida_clave: input.motivoPerdidaClave ?? null }
      });
    });

    return this.get(user, id);
  }

  // "Una oportunidad perdida puede reabrirse, conservando su historial"
  // (PLAN_CRM_DEFINITIVO.md) — no menciona reabrir una ganada, así que se
  // restringe a perdida: reabrir un cierre exitoso no tiene un caso de
  // negocio descrito y evita que alguien deshaga un cierre real por error.
  async reabrir(user: CurrentUser, id: number, input: ReabrirOportunidadInput) {
    const actual = await this.findScoped(user, id);
    if (!actual.oportunidad.cerrada) throw new HttpError(409, "La oportunidad no está cerrada");
    if (actual.etapaClave !== "perdida") throw new HttpError(409, "Solo una oportunidad perdida puede reabrirse");

    const [nuevaEtapa] = await this.db.select().from(catalogoEtapaEmbudo).where(eq(catalogoEtapaEmbudo.clave, input.etapaClave)).limit(1);
    if (!nuevaEtapa) throw new HttpError(404, "Etapa no encontrada");

    await this.db.transaction(async (tx) => {
      // eq(cerrada, true) + eq(etapaId, ...) + affectedRows (hallazgo de
      // code review, 14-sep-2026): mismo motivo que cambiarEtapa() --
      // condicionar por cerrada=true no basta solo, porque "ganada"
      // también es cerrada=true; se exige además que la etapa siga siendo
      // exactamente la "perdida" ya leída arriba, para que un cambiarEtapa
      // concurrente (ej. a "ganada") no deje reabrir() reabriendo el
      // cierre equivocado.
      const [result] = await tx.update(oportunidades).set({
        etapaId: nuevaEtapa.id,
        cerrada: false,
        motivoPerdidaId: null,
        motivoPerdidaDetalle: null
      }).where(and(eq(oportunidades.id, id), eq(oportunidades.cerrada, true), eq(oportunidades.etapaId, actual.oportunidad.etapaId)));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "La oportunidad cambió de estado, vuelve a intentarlo");
      }

      await tx.insert(historialEtapaOportunidad).values({
        oportunidadId: id,
        etapaId: nuevaEtapa.id,
        usuarioId: user.id,
        comentario: input.comentario ?? "Oportunidad reabierta"
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "oportunidad",
        entidadId: id,
        accion: "reabrir",
        antes: { etapa_clave: "perdida" },
        despues: { etapa_clave: nuevaEtapa.clave }
      });
    });

    return this.get(user, id);
  }
}
