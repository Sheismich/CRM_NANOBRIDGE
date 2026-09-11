import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, catalogoEtapaEmbudo, contactos, cotizacionPartidas, cotizaciones, empresas, oportunidades } from "../database/schema.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { HttpError } from "../shared/http-error.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CambiarEstadoCotizacionInput, CrearCotizacionInput, DatosCotizacionInput, ListCotizacionesQuery, PartidaInput } from "./dto/cotizacion.schema.js";

// "Una edición crea una nueva versión; la versión anterior queda
// obsoleta" (PLAN_CRM_DEFINITIVO.md #7) -- por eso 'obsoleta' no aparece
// como destino de ninguna transición manual: solo nuevaVersion() la fija,
// nunca cambiarEstado().
const TRANSICIONES: Record<string, string[]> = {
  borrador: ["enviada"],
  enviada: ["aceptada", "rechazada", "vencida"],
  aceptada: [],
  rechazada: [],
  vencida: [],
  obsoleta: []
};

function toRow(row: typeof cotizaciones.$inferSelect) {
  return {
    id: row.id,
    empresa_id: row.empresaId,
    oportunidad_id: row.oportunidadId,
    contacto_id: row.contactoId,
    cotizacion_raiz_id: row.cotizacionRaizId,
    version: row.version,
    moneda: row.moneda,
    subtotal: row.subtotal,
    descuento: row.descuento,
    impuestos: row.impuestos,
    total: row.total,
    fecha_emision: row.fechaEmision,
    fecha_envio: row.fechaEnvio,
    fecha_esperada_cierre: row.fechaEsperadaCierre,
    probabilidad: row.probabilidad,
    estado: row.estado,
    creado_por: row.creadoPor,
    creado_en: row.creadoEn,
    actualizado_en: row.actualizadoEn
  };
}

@Injectable()
export class CotizacionesService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  private calcular(partidas: PartidaInput[], descuento: number, impuestos: number) {
    // Cada importe se redondea aquí, no solo al guardarlo en
    // insertarPartidas(): así subtotal/total se calculan sobre los mismos
    // valores exactos que terminan en cotizacion_partidas.importe, en vez
    // de sobre floats sin redondear que pueden diferir en un centavo de la
    // suma de lo que realmente se guarda (hallazgo de code review, 11-sep-2026).
    const calculadas = partidas.map((p, index) => ({ ...p, importe: Number((p.cantidad * p.precioUnitario).toFixed(2)), orden: index }));
    const subtotal = Number(calculadas.reduce((acc, p) => acc + p.importe, 0).toFixed(2));
    const total = Number((subtotal - descuento + impuestos).toFixed(2));
    return { calculadas, subtotal, total };
  }

  private async insertarPartidas(tx: DrizzleTx, cotizacionId: number, partidas: ReturnType<typeof this.calcular>["calculadas"]) {
    for (const p of partidas) {
      await tx.insert(cotizacionPartidas).values({
        cotizacionId,
        descripcion: p.descripcion,
        cantidad: p.cantidad.toFixed(2),
        precioUnitario: p.precioUnitario.toFixed(2),
        importe: p.importe.toFixed(2),
        orden: p.orden
      });
    }
  }

  // Igual criterio que oportunidades: "el agente ve sus oportunidades
  // asignadas" (PLAN_CRM_DEFINITIVO.md) -- la cotización no tiene su
  // propio responsable, hereda el de la oportunidad a la que pertenece.
  private async validarOportunidad(user: CurrentUser, empresaId: number, oportunidadId: number) {
    const [row] = await this.db
      .select({ id: oportunidades.id, empresaId: oportunidades.empresaId, responsableId: oportunidades.responsableId, probabilidad: catalogoEtapaEmbudo.probabilidad })
      .from(oportunidades)
      .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
      .where(eq(oportunidades.id, oportunidadId))
      .limit(1);
    if (!row || row.empresaId !== empresaId || (user.rol === "agente" && row.responsableId !== user.id)) {
      throw new HttpError(404, "Oportunidad no encontrada en esa empresa");
    }
    return row;
  }

  private async validarContacto(empresaId: number, contactoId: number) {
    const [row] = await this.db.select({ id: contactos.id }).from(contactos).where(and(eq(contactos.id, contactoId), eq(contactos.empresaId, empresaId))).limit(1);
    if (!row) throw new HttpError(404, "Contacto no encontrado en esa empresa");
  }

  private async obtenerScoped(user: CurrentUser, id: number) {
    const [row] = await this.db
      .select({ cotizacion: cotizaciones, responsableId: oportunidades.responsableId })
      .from(cotizaciones)
      .innerJoin(oportunidades, eq(oportunidades.id, cotizaciones.oportunidadId))
      .where(eq(cotizaciones.id, id))
      .limit(1);
    if (!row || (user.rol === "agente" && row.responsableId !== user.id)) {
      throw new HttpError(404, "Cotización no encontrada");
    }
    return row.cotizacion;
  }

  async crear(user: CurrentUser, input: CrearCotizacionInput) {
    const [empresa] = await this.db.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, input.empresaId)).limit(1);
    if (!empresa) throw new HttpError(404, "Empresa no encontrada");

    const oportunidad = await this.validarOportunidad(user, input.empresaId, input.oportunidadId);
    if (input.contactoId) await this.validarContacto(input.empresaId, input.contactoId);

    const { calculadas, subtotal, total } = this.calcular(input.partidas, input.descuento, input.impuestos);

    return this.db.transaction(async (tx) => {
      const [result] = await tx.insert(cotizaciones).values({
        empresaId: input.empresaId,
        oportunidadId: input.oportunidadId,
        contactoId: input.contactoId ?? null,
        cotizacionRaizId: null,
        version: 1,
        subtotal: subtotal.toFixed(2),
        descuento: input.descuento.toFixed(2),
        impuestos: input.impuestos.toFixed(2),
        total: total.toFixed(2),
        // CURDATE() del propio MySQL, no new Date() en Node -- mismo
        // motivo que consultarCampanaActiva: evita el desfase de zona
        // horaria de un new Date() calculado en el servidor de la API.
        fechaEmision: sql`CURDATE()`,
        fechaEsperadaCierre: input.fechaEsperadaCierre ?? null,
        probabilidad: input.probabilidad ?? oportunidad.probabilidad,
        creadoPor: user.id
      });

      await this.insertarPartidas(tx, result.insertId, calculadas);

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "cotizacion",
        entidadId: result.insertId,
        accion: "crear",
        despues: { empresa_id: input.empresaId, oportunidad_id: input.oportunidadId, total }
      });

      return { id: result.insertId, version: 1 };
    });
  }

  async nuevaVersion(user: CurrentUser, id: number, input: DatosCotizacionInput) {
    const actual = await this.obtenerScoped(user, id);
    if (actual.estado === "obsoleta") throw new HttpError(409, "No se puede versionar una cotización ya obsoleta");

    const contactoId = input.contactoId ?? actual.contactoId;
    if (contactoId) await this.validarContacto(actual.empresaId, contactoId);

    const { calculadas, subtotal, total } = this.calcular(input.partidas, input.descuento, input.impuestos);
    const raizId = actual.cotizacionRaizId ?? actual.id;
    const nuevaVersionNum = actual.version + 1;

    return this.db.transaction(async (tx) => {
      // obtenerScoped() validó el estado fuera de cualquier bloqueo -- dos
      // POST .../version concurrentes podían leer ambos version=N y
      // terminar insertando dos filas "vigentes" con esa misma versión.
      // Revalidar dentro del propio UPDATE (WHERE ... AND estado !=
      // 'obsoleta') y chequear affectedRows cierra la carrera: solo una de
      // las dos solicitudes gana el marcado como obsoleta y continúa a
      // insertar la nueva versión (mismo patrón que TareasService.cerrar(),
      // hallazgo de code review, 11-sep-2026).
      const [marcarObsoleta] = await tx.update(cotizaciones).set({ estado: "obsoleta" }).where(and(eq(cotizaciones.id, actual.id), ne(cotizaciones.estado, "obsoleta")));
      if (marcarObsoleta.affectedRows === 0) {
        throw new HttpError(409, "La cotización ya fue versionada o marcada obsoleta por otra solicitud");
      }

      const [result] = await tx.insert(cotizaciones).values({
        empresaId: actual.empresaId,
        oportunidadId: actual.oportunidadId,
        contactoId: contactoId ?? null,
        cotizacionRaizId: raizId,
        version: nuevaVersionNum,
        subtotal: subtotal.toFixed(2),
        descuento: input.descuento.toFixed(2),
        impuestos: input.impuestos.toFixed(2),
        total: total.toFixed(2),
        fechaEmision: sql`CURDATE()`,
        fechaEsperadaCierre: input.fechaEsperadaCierre ?? actual.fechaEsperadaCierre,
        probabilidad: input.probabilidad ?? actual.probabilidad,
        creadoPor: user.id
      });

      await this.insertarPartidas(tx, result.insertId, calculadas);

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "cotizacion",
        entidadId: result.insertId,
        accion: "nueva_version",
        antes: { cotizacion_anterior_id: actual.id, estado_anterior: actual.estado },
        despues: { version: nuevaVersionNum, total }
      });

      return { id: result.insertId, version: nuevaVersionNum };
    });
  }

  async list(user: CurrentUser, query: ListCotizacionesQuery) {
    const [empresa] = await this.db.select({ id: empresas.id }).from(empresas).where(eq(empresas.id, query.empresaId)).limit(1);
    if (!empresa) throw new HttpError(404, "Empresa no encontrada");

    const offset = (query.page - 1) * query.limit;
    const conditions = compactConditions([
      eq(cotizaciones.empresaId, query.empresaId),
      // Solo la versión vigente de cada cadena: una obsoleta solo se ve
      // explícitamente en GET /cotizaciones/:id (campo "versiones").
      ne(cotizaciones.estado, "obsoleta"),
      query.oportunidadId ? eq(cotizaciones.oportunidadId, query.oportunidadId) : undefined,
      user.rol === "agente" ? eq(oportunidades.responsableId, user.id) : undefined
    ]);

    const rows = await this.db
      .select({ cotizacion: cotizaciones })
      .from(cotizaciones)
      .innerJoin(oportunidades, eq(oportunidades.id, cotizaciones.oportunidadId))
      .where(and(...conditions))
      .orderBy(desc(cotizaciones.actualizadoEn))
      .limit(query.limit)
      .offset(offset);

    return { page: query.page, limit: query.limit, data: rows.map((r) => toRow(r.cotizacion)) };
  }

  async get(user: CurrentUser, id: number) {
    const cotizacion = await this.obtenerScoped(user, id);

    const partidasRows = await this.db.select().from(cotizacionPartidas).where(eq(cotizacionPartidas.cotizacionId, id)).orderBy(cotizacionPartidas.orden);

    const raizId = cotizacion.cotizacionRaizId ?? cotizacion.id;
    const versiones = await this.db
      .select({ id: cotizaciones.id, version: cotizaciones.version, estado: cotizaciones.estado, total: cotizaciones.total, creadoEn: cotizaciones.creadoEn })
      .from(cotizaciones)
      .where(or(eq(cotizaciones.id, raizId), eq(cotizaciones.cotizacionRaizId, raizId)))
      .orderBy(cotizaciones.version);

    return {
      ...toRow(cotizacion),
      partidas: partidasRows.map((p) => ({ id: p.id, descripcion: p.descripcion, cantidad: p.cantidad, precio_unitario: p.precioUnitario, importe: p.importe, orden: p.orden })),
      versiones: versiones.map((v) => ({ id: v.id, version: v.version, estado: v.estado, total: v.total, creado_en: v.creadoEn }))
    };
  }

  async cambiarEstado(user: CurrentUser, id: number, input: CambiarEstadoCotizacionInput) {
    const cotizacion = await this.obtenerScoped(user, id);
    const permitidas = TRANSICIONES[cotizacion.estado] ?? [];
    if (!permitidas.includes(input.estado)) {
      throw new HttpError(409, `No se puede pasar de '${cotizacion.estado}' a '${input.estado}'`);
    }

    await this.db.transaction(async (tx) => {
      // Mismo problema que nuevaVersion(): el guard de arriba valida contra
      // un estado leído fuera de cualquier bloqueo. Revalidar dentro del
      // propio UPDATE (WHERE ... AND estado = <el que se validó>) y
      // chequear affectedRows cierra la carrera -- dos PATCH .../estado
      // concurrentes ya no pueden aplicar ambos una transición mutuamente
      // excluyente (ej. aceptada y rechazada) sobre el mismo 'enviada'
      // (hallazgo de code review, 11-sep-2026).
      const set = input.estado === "enviada" ? { estado: input.estado, fechaEnvio: sql`CURDATE()` } : { estado: input.estado };
      const [result] = await tx.update(cotizaciones).set(set).where(and(eq(cotizaciones.id, id), eq(cotizaciones.estado, cotizacion.estado)));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "El estado de la cotización cambió, vuelve a intentarlo");
      }

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "cotizacion",
        entidadId: id,
        accion: "cambiar_estado",
        antes: { estado: cotizacion.estado },
        despues: { estado: input.estado }
      });
    });

    return this.get(user, id);
  }
}
