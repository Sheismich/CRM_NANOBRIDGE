import { Inject, Injectable } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, like, or, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { actividades, auditoria, contactos, empresas, envios, mediosContacto, oportunidades, prospectos, respuestas, usuarios } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { buildAntes, compactConditions, patronLike } from "../shared/drizzle-utils.js";
import { insertarMediosContacto, buildMedioCandidatos, estadoInicialDeMedio, CODIGO_MEDIO_SUPRIMIDO } from "../shared/medios-contacto.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CompanyInput, ContactInput, ListEmpresasQuery, UpdateCompanyInput, UpdateContactInput } from "./dto/empresa.schema.js";

// Las respuestas siguen usando claves snake_case (nombre_legal,
// propietario_id, medio_tipo, etc.) aunque las columnas de
// src/database/schema.ts estén en camelCase: es el mismo contrato HTTP que
// ya consumen n8n y el CRM, solo cambió cómo se arman las queries por dentro.

// Piso para "sin fecha" en la última actividad de la lista (GREATEST con un
// NULL da NULL); se vuelve NULL antes de responder.
const PISO_FECHA = sql`CAST('1000-01-01 00:00:00' AS DATETIME)`;

// Última actividad de una empresa: lo más reciente entre actividades
// registradas, correos enviados y respuestas. GREATEST da NULL si algún
// argumento es NULL, de ahí el piso. La usan la lista (columna y orden) y
// los conteos.
function ultimaActividadSql() {
  return sql<Date | null>`NULLIF(GREATEST(
    COALESCE((SELECT MAX(${actividades.ocurridaEn}) FROM ${actividades} WHERE ${actividades.empresaId} = ${empresas.id}), ${PISO_FECHA}),
    COALESCE((SELECT MAX(${envios.enviadoEn}) FROM ${envios} INNER JOIN ${prospectos} ON ${prospectos.id} = ${envios.prospectoId} INNER JOIN ${contactos} ON ${contactos.id} = ${prospectos.contactoId} WHERE ${contactos.empresaId} = ${empresas.id}), ${PISO_FECHA}),
    COALESCE((SELECT MAX(${respuestas.recibidoEn}) FROM ${respuestas} INNER JOIN ${prospectos} ON ${prospectos.id} = ${respuestas.prospectoId} INNER JOIN ${contactos} ON ${contactos.id} = ${prospectos.contactoId} WHERE ${contactos.empresaId} = ${empresas.id}), ${PISO_FECHA})
  ), ${PISO_FECHA})`;
}

export type FiltrosEmpresas = Omit<ListEmpresasQuery, "page" | "limit">;

@Injectable()
export class EmpresasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(user: CurrentUser, page: number, limit: number, filtros: FiltrosEmpresas = { orden: "nombre", sinResponsable: undefined }) {
    const offset = (page - 1) * limit;
    const ownsOnly = user.rol === "agente";
    const condition = and(...compactConditions([
      eq(empresas.activo, true),
      ownsOnly ? eq(empresas.propietarioId, user.id) : undefined,
      filtros.q ? or(
        like(empresas.nombreLegal, patronLike(filtros.q)),
        like(empresas.nombreComercial, patronLike(filtros.q)),
        like(empresas.giro, patronLike(filtros.q)),
        like(empresas.ciudad, patronLike(filtros.q))
      ) : undefined,
      filtros.giro ? eq(empresas.giro, filtros.giro) : undefined,
      filtros.region ? eq(empresas.region, filtros.region) : undefined,
      // Un agente ya ve solo lo suyo: estos dos filtros solo cambian algo
      // para administrador y supervisor.
      !ownsOnly && filtros.responsableId ? eq(empresas.propietarioId, filtros.responsableId) : undefined,
      !ownsOnly && filtros.sinResponsable ? isNull(empresas.propietarioId) : undefined
    ]));
    const ultimaActividad = ultimaActividadSql();
    // Por actividad: la más reciente primero, las que nunca tuvieron nada al
    // final (DESC ya deja los NULL al último en MySQL); el id desempata.
    const orden = filtros.orden === "actividad" ? [desc(ultimaActividad), asc(empresas.id)] : [asc(empresas.nombreLegal), asc(empresas.id)];

    const rows = await this.db
      .select({
        id: empresas.id,
        nombre_legal: empresas.nombreLegal,
        nombre_comercial: empresas.nombreComercial,
        giro: empresas.giro,
        region: empresas.region,
        estado: empresas.estado,
        ciudad: empresas.ciudad,
        activo: empresas.activo,
        creado_en: empresas.creadoEn,
        // Para la lista general (PLAN_FRONTEND.md, "Pantallas menos
        // genéricas"): de quién es, cuántos contactos activos tiene y
        // cuándo se le registró la última actividad, sin un GET por fila.
        propietario_id: empresas.propietarioId,
        propietario_nombre: usuarios.nombre,
        contactos_activos: sql<number>`(SELECT COUNT(*) FROM ${contactos} WHERE ${contactos.empresaId} = ${empresas.id} AND ${contactos.activo} = true)`.mapWith(Number),
        // Lo más reciente entre lo registrado a mano, los correos de la
        // automatización y las respuestas (lo mismo que junta el Historial):
        // una empresa a la que n8n le escribió ayer no es "Ninguna".
        ultima_actividad: ultimaActividad.mapWith(actividades.ocurridaEn)
      })
      .from(empresas)
      .leftJoin(usuarios, eq(usuarios.id, empresas.propietarioId))
      .where(condition)
      .orderBy(...orden)
      .limit(limit)
      .offset(offset);

    const detalle = await this.detalleDeLista(rows.map((r) => r.id));
    return { page, limit, data: rows.map((r) => ({ ...r, ...(detalle.get(r.id) ?? { prospeccion: null, ultima_actividad_detalle: null }) })) };
  }

  // Lo que la lista de Empresas (9-oct-2026) dice además de la fecha:
  //  - prospeccion: en qué va su prospecto más reciente y cuántos correos
  //    lleva (null si la empresa nunca fue prospecto).
  //  - ultima_actividad_detalle: qué fue lo último que pasó -- una actividad
  //    registrada (con su tipo), un correo (con su número) o una respuesta
  //    (con su clasificación); null si nunca pasó nada.
  // Tres consultas para toda la página (no una por fila), con ROW_NUMBER
  // para quedarse con la última de cada empresa.
  private async detalleDeLista(ids: number[]) {
    const resultado = new Map<number, { prospeccion: { estado: string; envios: number } | null; ultima_actividad_detalle: Record<string, unknown> | null }>();
    if (ids.length === 0) return resultado;
    const lista = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    type Fila = { empresa_id: number; fecha: Date; [k: string]: unknown };
    const filas = async (consulta: SQL) => ((await this.db.execute(consulta)) as unknown as [Fila[]])[0];

    const [prospeccion, ultimaManual, ultimoEnvio, ultimaRespuesta] = await Promise.all([
      filas(sql`SELECT empresa_id, estado, envios FROM (
          SELECT c.empresa_id, p.estado, (SELECT COUNT(*) FROM envios e WHERE e.prospecto_id = p.id) AS envios,
                 ROW_NUMBER() OVER (PARTITION BY c.empresa_id ORDER BY p.id DESC) AS n
          FROM prospectos p INNER JOIN contactos c ON c.id = p.contacto_id WHERE c.empresa_id IN (${lista})) t WHERE n = 1`),
      filas(sql`SELECT empresa_id, fecha, tipo FROM (
          SELECT a.empresa_id, a.ocurrida_en AS fecha, a.tipo, ROW_NUMBER() OVER (PARTITION BY a.empresa_id ORDER BY a.ocurrida_en DESC, a.id DESC) AS n
          FROM actividades a WHERE a.empresa_id IN (${lista})) t WHERE n = 1`),
      filas(sql`SELECT empresa_id, fecha, numero_contacto FROM (
          SELECT c.empresa_id, e.enviado_en AS fecha, e.numero_contacto, ROW_NUMBER() OVER (PARTITION BY c.empresa_id ORDER BY e.enviado_en DESC, e.id DESC) AS n
          FROM envios e INNER JOIN prospectos p ON p.id = e.prospecto_id INNER JOIN contactos c ON c.id = p.contacto_id WHERE c.empresa_id IN (${lista})) t WHERE n = 1`),
      filas(sql`SELECT empresa_id, fecha, clasificacion FROM (
          SELECT c.empresa_id, r.recibido_en AS fecha, r.clasificacion, ROW_NUMBER() OVER (PARTITION BY c.empresa_id ORDER BY r.recibido_en DESC, r.id DESC) AS n
          FROM respuestas r INNER JOIN prospectos p ON p.id = r.prospecto_id INNER JOIN contactos c ON c.id = p.contacto_id WHERE c.empresa_id IN (${lista})) t WHERE n = 1`)
    ]);

    for (const id of ids) resultado.set(id, { prospeccion: null, ultima_actividad_detalle: null });
    for (const f of prospeccion) resultado.get(Number(f.empresa_id))!.prospeccion = { estado: String(f.estado), envios: Number(f.envios) };

    // La más reciente de las tres fuentes; con la misma fecha gana la
    // respuesta (es lo que más le importa a quien lee la lista).
    const candidatos = [
      ...ultimaRespuesta.map((f) => ({ empresaId: Number(f.empresa_id), fecha: new Date(f.fecha), prioridad: 0, detalle: { tipo: "respuesta", clasificacion: f.clasificacion ?? null } })),
      ...ultimoEnvio.map((f) => ({ empresaId: Number(f.empresa_id), fecha: new Date(f.fecha), prioridad: 1, detalle: { tipo: "envio", numero_contacto: Number(f.numero_contacto) } })),
      ...ultimaManual.map((f) => ({ empresaId: Number(f.empresa_id), fecha: new Date(f.fecha), prioridad: 2, detalle: { tipo: "actividad", actividad_tipo: f.tipo } }))
    ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime() || a.prioridad - b.prioridad);
    for (const c of candidatos) {
      const fila = resultado.get(c.empresaId)!;
      if (!fila.ultima_actividad_detalle) fila.ultima_actividad_detalle = c.detalle;
    }
    return resultado;
  }

  // Tarjetas de arriba de la lista de Empresas (9-oct-2026). Mismo alcance
  // que la lista: un agente cuenta solo las suyas.
  //  - sin_actividad_30_dias: ni actividad registrada, ni correo, ni
  //    respuesta en los últimos 30 días (o nunca).
  //  - con_oportunidad_abierta y su valor: oportunidades no cerradas.
  async conteos(user: CurrentUser) {
    const alcance = and(...compactConditions([eq(empresas.activo, true), user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined]));
    const hace30 = sql`DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)`;
    const [[fila], [opor]] = await Promise.all([
      this.db
        .select({
          total: sql<number>`COUNT(*)`.mapWith(Number),
          sinResponsable: sql<number>`COALESCE(SUM(${empresas.propietarioId} IS NULL), 0)`.mapWith(Number),
          sinActividad: sql<number>`COALESCE(SUM(${ultimaActividadSql()} IS NULL OR ${ultimaActividadSql()} < ${hace30}), 0)`.mapWith(Number)
        })
        .from(empresas)
        .where(alcance),
      this.db
        .select({
          empresas: sql<number>`COUNT(DISTINCT ${oportunidades.empresaId})`.mapWith(Number),
          valor: sql<string>`COALESCE(SUM(${oportunidades.valorEstimado}), 0)`
        })
        .from(oportunidades)
        .innerJoin(empresas, eq(empresas.id, oportunidades.empresaId))
        .where(and(alcance, eq(oportunidades.cerrada, false)))
    ]);
    return {
      total: fila.total,
      sin_responsable: fila.sinResponsable,
      sin_actividad_30_dias: fila.sinActividad,
      con_oportunidad_abierta: opor.empresas,
      valor_oportunidades_abiertas: String(opor.valor)
    };
  }

  async create(user: CurrentUser, input: CompanyInput) {
    return this.db.transaction(async (tx) => {
      const [company] = await tx.insert(empresas).values({
        nombreLegal: input.nombreLegal,
        nombreComercial: input.nombreComercial ?? null,
        giro: input.giro ?? null,
        tamano: input.tamano ?? null,
        region: input.region ?? null,
        estado: input.estado ?? null,
        ciudad: input.ciudad ?? null,
        pais: input.pais.toUpperCase(),
        sitioWeb: input.sitioWeb ?? null,
        linkedinUrl: input.linkedinUrl ?? null,
        facebookUrl: input.facebookUrl ?? null,
        instagramUrl: input.instagramUrl ?? null,
        propietarioId: user.id
      });

      for (const contact of input.contactos) {
        await this.insertarContactoConMedios(tx, company.insertId, contact);
      }

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "empresa",
        entidadId: company.insertId,
        accion: "crear",
        despues: { nombreLegal: input.nombreLegal }
      });

      return company.insertId;
    });
  }

  async get(user: CurrentUser, id: number) {
    const company = await this.findEmpresaScoped(this.db, user, id);
    const contactRows = await this.contactosConMedios(and(eq(contactos.empresaId, id), eq(contactos.activo, true)));
    // De dónde vino (ficha de Empresa, 9-oct-2026): la fuente del prospecto
    // más reciente que tenga una (LinkedIn, el sitio de la empresa, etc.).
    const [fuente] = await this.db
      .select({ fuenteUrl: prospectos.fuenteUrl })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .where(and(eq(contactos.empresaId, id), sql`${prospectos.fuenteUrl} IS NOT NULL`))
      .orderBy(desc(prospectos.id))
      .limit(1);
    // En qué va su prospección (pastilla del encabezado de la ficha,
    // 15-oct-2026): el mismo cálculo que la lista.
    const { prospeccion } = (await this.detalleDeLista([id])).get(id)!;

    return {
      id: company.id,
      nombre_legal: company.nombreLegal,
      nombre_comercial: company.nombreComercial,
      giro: company.giro,
      tamano: company.tamano,
      region: company.region,
      estado: company.estado,
      ciudad: company.ciudad,
      pais: company.pais,
      sitio_web: company.sitioWeb,
      linkedin_url: company.linkedinUrl,
      facebook_url: company.facebookUrl,
      instagram_url: company.instagramUrl,
      propietario_id: company.propietarioId,
      activo: true,
      creado_en: company.creadoEn,
      actualizado_en: company.actualizadoEn,
      fuente_url: fuente?.fuenteUrl ?? null,
      prospeccion,
      contactos: contactRows
    };
  }

  async update(user: CurrentUser, id: number, input: UpdateCompanyInput) {
    await this.db.transaction(async (tx) => {
      // findEmpresaScoped bloquea la fila (SELECT ... FOR UPDATE) hasta que
      // esta transacción termine -- un deactivate() concurrente sobre la
      // misma empresa se queda esperando en su propio SELECT bloqueante en
      // vez de poder colarse a mitad de este update (hallazgo de code
      // review, 14-sep-2026: antes no había ningún guard y una empresa
      // podía editarse justo después de haber sido desactivada).
      const before = await this.findEmpresaScoped(tx, user, id, true);

      const set: Partial<typeof empresas.$inferInsert> = {};
      if (input.nombreLegal !== undefined) set.nombreLegal = input.nombreLegal;
      if (input.nombreComercial !== undefined) set.nombreComercial = input.nombreComercial;
      if (input.giro !== undefined) set.giro = input.giro;
      if (input.tamano !== undefined) set.tamano = input.tamano;
      if (input.region !== undefined) set.region = input.region;
      if (input.estado !== undefined) set.estado = input.estado;
      if (input.ciudad !== undefined) set.ciudad = input.ciudad;
      if (input.pais !== undefined) set.pais = input.pais.toUpperCase();
      if (input.sitioWeb !== undefined) set.sitioWeb = input.sitioWeb;
      if (input.linkedinUrl !== undefined) set.linkedinUrl = input.linkedinUrl;
      if (input.facebookUrl !== undefined) set.facebookUrl = input.facebookUrl;
      if (input.instagramUrl !== undefined) set.instagramUrl = input.instagramUrl;

      // eq(activo, true) es una defensa adicional, no la protección
      // principal contra la carrera (esa ya la da el FOR UPDATE de arriba):
      // a propósito NO se revisa affectedRows aquí -- si el valor nuevo es
      // idéntico al que ya tenía la fila, MySQL reporta 0 filas afectadas
      // (cuenta filas CAMBIADAS, no encontradas) aunque el update sea
      // perfectamente válido, y un check ingenuo lanzaría un 409 falso.
      await tx.update(empresas).set(set).where(and(eq(empresas.id, id), eq(empresas.activo, true)));

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "empresa",
        entidadId: id,
        accion: "actualizar",
        antes: buildAntes(before, set),
        despues: set
      });
    });

    return this.get(user, id);
  }

  // Restringido a administrador/supervisor (RolesGuard en el controller):
  // desactivar una empresa oculta de golpe todos sus contactos (get()/
  // list() ya filtran por activo=true) -- más sensible que crearla. El
  // plan no detalla el rol exacto.
  //
  // NO cascada a oportunidades ya abiertas: OportunidadesService.create()
  // sí rechaza oportunidades NUEVAS contra una empresa desactivada
  // (hallazgo de code review, 14-sep-2026), pero una oportunidad que ya
  // estaba abierta contra esta empresa sigue visible/editable en
  // /api/v1/oportunidades después de desactivarla -- cerrar o reasignar
  // las oportunidades ya abiertas de una empresa desactivada es una
  // decisión de producto que queda fuera de este alcance.
  async deactivate(user: CurrentUser, id: number) {
    await this.db.transaction(async (tx) => {
      const [company] = await tx
        .select({ id: empresas.id, nombreLegal: empresas.nombreLegal })
        .from(empresas)
        .where(and(eq(empresas.id, id), eq(empresas.activo, true)))
        .limit(1)
        .for("update");
      if (!company) throw new HttpError(404, "Empresa no encontrada");

      // Aquí SÍ es correcto revisar affectedRows: activo pasa de true a
      // false, siempre es un cambio real (a diferencia del update() de
      // arriba), así que 0 filas afectadas solo puede significar que otra
      // solicitud ganó la carrera -- aunque el FOR UPDATE de arriba ya lo
      // hace prácticamente imposible, se deja como defensa adicional.
      const [result] = await tx.update(empresas).set({ activo: false }).where(and(eq(empresas.id, id), eq(empresas.activo, true)));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "La empresa ya fue desactivada por otra solicitud");
      }

      const contactRows = await tx.select({ id: contactos.id }).from(contactos).where(and(eq(contactos.empresaId, id), eq(contactos.activo, true)));
      const contactIds = contactRows.map((row) => row.id);

      if (contactIds.length > 0) {
        await tx.update(contactos).set({ activo: false }).where(inArray(contactos.id, contactIds));
      }

      // Los medios de contacto "corporativos" cuelgan directo de la empresa
      // (empresa_id, sin contacto_id) y los del contacto cuelgan de este
      // último -- PLAN_CRM_DEFINITIVO.md #2: "los medios corporativos
      // compartidos pertenecen a la empresa, no a un contacto individual".
      // Sin marcar también estos como obsoletos, automatizacion.service.ts
      // (validarProspecto/verificarEnvio) seguiría viéndolos como 'activo'
      // y la automatización podría seguir contactando a una empresa ya
      // desactivada.
      const medioCondition = contactIds.length > 0 ? or(eq(mediosContacto.empresaId, id), inArray(mediosContacto.contactoId, contactIds)) : eq(mediosContacto.empresaId, id);
      await tx.update(mediosContacto).set({ estadoContacto: "obsoleto" }).where(and(eq(mediosContacto.estadoContacto, "activo"), medioCondition));

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "empresa",
        entidadId: id,
        accion: "desactivar",
        antes: { activo: true, nombre_legal: company.nombreLegal },
        despues: { activo: false }
      });
    });
  }

  async addContact(user: CurrentUser, empresaId: number, input: ContactInput) {
    return this.db.transaction(async (tx) => {
      await this.findEmpresaOwnership(tx, user, empresaId);
      const contactoId = await this.insertarContactoConMedios(tx, empresaId, input);

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "contacto",
        entidadId: contactoId,
        accion: "crear",
        despues: { empresa_id: empresaId, nombre: input.nombre }
      });

      return contactoId;
    });
  }

  async updateContact(user: CurrentUser, empresaId: number, contactoId: number, input: UpdateContactInput) {
    await this.db.transaction(async (tx) => {
      await this.findEmpresaOwnership(tx, user, empresaId);

      // FOR UPDATE: mismo motivo que en update() -- sin esto, un
      // deactivateContact() concurrente podía colarse entre este SELECT y
      // los UPDATE de abajo (hallazgo de code review, 14-sep-2026).
      const [before] = await tx
        .select({ id: contactos.id, nombre: contactos.nombre, puesto: contactos.puesto, area: contactos.area, linkedinUrl: contactos.linkedinUrl, facebookUrl: contactos.facebookUrl, instagramUrl: contactos.instagramUrl })
        .from(contactos)
        .where(and(eq(contactos.id, contactoId), eq(contactos.empresaId, empresaId), eq(contactos.activo, true)))
        .limit(1)
        .for("update");
      if (!before) throw new HttpError(404, "Contacto no encontrado");

      const set: Partial<typeof contactos.$inferInsert> = {};
      if (input.nombre !== undefined) set.nombre = input.nombre;
      if (input.puesto !== undefined) set.puesto = input.puesto;
      if (input.area !== undefined) set.area = input.area;
      if (input.linkedinUrl !== undefined) set.linkedinUrl = input.linkedinUrl;
      if (input.facebookUrl !== undefined) set.facebookUrl = input.facebookUrl;
      if (input.instagramUrl !== undefined) set.instagramUrl = input.instagramUrl;

      if (Object.keys(set).length > 0) {
        await tx.update(contactos).set(set).where(and(eq(contactos.id, contactoId), eq(contactos.activo, true)));
      }

      // Cada contacto tiene a lo más una fila por tipo de medio (el mismo
      // invariante que mantiene insertarMediosContacto en create()):
      // actualizar hace UPDATE en el lugar sobre esa fila (o la crea si no
      // existía) en vez de insertar una nueva -- así el UNIQUE(tipo,
      // valor_normalizado) global solo puede chocar contra OTRO contacto,
      // nunca contra la fila anterior de este mismo contacto.
      //
      // Un solo SELECT trae las hasta 3 filas existentes (correo/telefono/
      // whatsapp) de una vez en vez de una por tipo dentro del loop
      // (hallazgo de code review, 14-sep-2026).
      const existingMedios = await tx
        .select({ id: mediosContacto.id, tipo: mediosContacto.tipo, valorNormalizado: mediosContacto.valorNormalizado, estadoContacto: mediosContacto.estadoContacto })
        .from(mediosContacto)
        .where(and(eq(mediosContacto.contactoId, contactoId), inArray(mediosContacto.tipo, ["correo", "telefono", "whatsapp"])));
      const existingByTipo = new Map(existingMedios.map((m) => [m.tipo, m]));

      const medios: { tipo: "correo" | "telefono" | "whatsapp"; valor: string | null | undefined; normalizar: (v: string) => string }[] = [
        { tipo: "correo", valor: input.correo, normalizar: normalizeEmail },
        { tipo: "telefono", valor: input.telefono, normalizar: normalizePhone },
        { tipo: "whatsapp", valor: input.whatsapp, normalizar: normalizePhone }
      ];

      // A diferencia de `set` (columnas de la tabla contactos), los cambios
      // a los medios de contacto no pasan por un UPDATE de esa tabla, así
      // que sin esto quedaban fuera del snapshot de auditoría por completo
      // -- un PATCH que solo cambiaba el correo insertaba una fila de
      // auditoría con antes:{} y despues:{}, sin rastro de qué cambió
      // (hallazgo de code review, 14-sep-2026).
      const medioAntes: Record<string, unknown> = {};
      const medioDespues: Record<string, unknown> = {};

      for (const medio of medios) {
        if (medio.valor === undefined) continue; // no incluido en el body -> sin cambios

        const existing = existingByTipo.get(medio.tipo);

        // Un medio en no_contactar no se cambia ni se borra (A4 del plan de
        // fixes, 2-oct-2026): antes un PATCH a otro valor sobrescribía la
        // fila como activo y el bloqueo se perdía; luego se podía volver a
        // poner el valor suprimido. Mandar el mismo valor sin cambios sigue
        // permitido (se ignora más abajo).
        if (existing?.estadoContacto === "no_contactar" && (medio.valor === null || medio.normalizar(medio.valor) !== existing.valorNormalizado)) {
          throw new HttpError(409, `El ${medio.tipo} de este contacto pidió no ser contactado; no se puede cambiar ni borrar`, CODIGO_MEDIO_SUPRIMIDO);
        }

        if (medio.valor === null) {
          // Borrar el medio = marcarlo obsoleto, nunca DELETE (PLAN_CRM_
          // DEFINITIVO.md #2, "no se borra información").
          if (existing) {
            await tx.update(mediosContacto).set({ estadoContacto: "obsoleto" }).where(eq(mediosContacto.id, existing.id));
            medioAntes[medio.tipo] = { valor: existing.valorNormalizado, estado_contacto: existing.estadoContacto };
            medioDespues[medio.tipo] = null;
          }
          continue;
        }

        const valorNormalizado = medio.normalizar(medio.valor);

        // Si el valor es idéntico al que ya tenía Y ese medio está en
        // no_contactar, NO reactivar solo -- no_contactar es un opt-out
        // explícito (cumplimiento); un PATCH que de paso reenvía el mismo
        // dato sin cambios (ej. un formulario que manda el objeto
        // completo) no debe revertirlo sin una acción deliberada
        // (hallazgo de code review, 14-sep-2026).
        if (existing && existing.estadoContacto === "no_contactar" && existing.valorNormalizado === valorNormalizado) {
          continue;
        }

        if (existing && existing.valorNormalizado === valorNormalizado && existing.estadoContacto === "activo") {
          continue; // ya está exactamente así, no generar un UPDATE ni una entrada de auditoría vacía
        }

        try {
          if (existing) {
            // Un valor nuevo que está en lista_supresion (o de alguien en
            // baja) queda bloqueado desde el inicio.
            const estadoContacto = await estadoInicialDeMedio(tx, contactoId, medio.tipo, valorNormalizado);
            await tx.update(mediosContacto).set({ valor: medio.valor, valorNormalizado, estadoContacto }).where(eq(mediosContacto.id, existing.id));
          } else {
            await insertarMediosContacto(tx, contactoId, [{ tipo: medio.tipo, valor: medio.valor, valorNormalizado }]);
          }
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new HttpError(409, `El ${medio.tipo} ya está registrado en otro contacto`);
          }
          throw error;
        }

        // Si `existing` estaba en no_contactar y el valor SÍ cambió (caso
        // distinto al continue de arriba), esta rama sobrescribe esa fila
        // en el lugar en vez de conservarla como obsoleta -- se acepta
        // porque es, en los hechos, un medio nuevo (ej. un número de
        // teléfono distinto) y no tiene sentido heredar el opt-out de un
        // valor distinto; el registro de que el valor ANTERIOR estuvo en
        // no_contactar queda preservado aquí, en `medioAntes`, que es de
        // donde este sistema ya lee su historial (igual que
        // cotizaciones/oportunidades, que tampoco duplican filas para
        // conservar historial: lo dejan en `auditoria`).
        medioAntes[medio.tipo] = existing ? { valor: existing.valorNormalizado, estado_contacto: existing.estadoContacto } : null;
        medioDespues[medio.tipo] = valorNormalizado;
      }

      // Invariante de creación (contactInputSchema: "al menos un medio de
      // contacto") reforzada también en la edición -- sin esto, un PATCH
      // que limpia el único medio dejaba el contacto sin ningún dato de
      // contacto, algo que crear() nunca permitió (hallazgo de code review,
      // 14-sep-2026). Cuenta los no obsoletos, no solo los activos: una
      // persona dada de baja tiene todos sus medios en no_contactar y aun así
      // se debe poder editar (p. ej. corregir su puesto); antes cualquier
      // PATCH suyo daba 409 (A4, 2-oct-2026).
      const [{ vigentes }] = await tx
        .select({ vigentes: sql<number>`count(*)` })
        .from(mediosContacto)
        .where(and(eq(mediosContacto.contactoId, contactoId), inArray(mediosContacto.estadoContacto, ["activo", "no_contactar"])));
      if (Number(vigentes) === 0) {
        throw new HttpError(409, "El contacto debe conservar al menos un medio de contacto");
      }

      // Si el PATCH terminó sin cambiar nada de verdad (ej. reenviar el
      // mismo valor de un medio en no_contactar, que se ignora a
      // propósito más arriba), no insertar una fila de auditoría vacía
      // (antes:{}, despues:{}) que no aporta nada al historial.
      const antes = { ...buildAntes(before, set), ...medioAntes };
      const despues = { ...set, ...medioDespues };
      if (Object.keys(antes).length > 0 || Object.keys(despues).length > 0) {
        await tx.insert(auditoria).values({
          usuarioId: user.id,
          entidad: "contacto",
          entidadId: contactoId,
          accion: "actualizar",
          antes,
          despues
        });
      }
    });

    // eq(contactos.activo, true): si el contacto fue desactivado justo
    // después de que la transacción de arriba liberó el lock (ej. otra
    // solicitud lo desactivó entre el commit y esta lectura), esta
    // respuesta no debe mostrarlo como si siguiera activo (hallazgo de
    // code review, 14-sep-2026). Se devuelve el arreglo completo de
    // contactosConMedios (una fila por medio), no solo la primera -- antes
    // `const [contact] = ...` descartaba silenciosamente los demás medios
    // del contacto (mismo hallazgo).
    const rows = await this.contactosConMedios(and(eq(contactos.id, contactoId), eq(contactos.empresaId, empresaId), eq(contactos.activo, true)));
    if (rows.length === 0) throw new HttpError(404, "Contacto no encontrado");
    return rows;
  }

  // A diferencia de EmpresasService.deactivate (admin/supervisor), aquí SÍ
  // se permite agente (dueño de la empresa): desactivar un solo contacto
  // tiene mucho menor alcance que desactivar la empresa completa (esa sí
  // oculta de golpe TODOS sus contactos de una vez) -- el rol más
  // restringido se reserva para esa acción de mayor impacto, no para cada
  // contacto individual.
  async deactivateContact(user: CurrentUser, empresaId: number, contactoId: number) {
    await this.db.transaction(async (tx) => {
      await this.findEmpresaOwnership(tx, user, empresaId);

      const [result] = await tx.update(contactos).set({ activo: false }).where(and(eq(contactos.id, contactoId), eq(contactos.empresaId, empresaId), eq(contactos.activo, true)));
      if (result.affectedRows === 0) throw new HttpError(404, "Contacto no encontrado");

      await tx.update(mediosContacto).set({ estadoContacto: "obsoleto" }).where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.estadoContacto, "activo")));

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "contacto",
        entidadId: contactoId,
        accion: "desactivar",
        antes: { activo: true },
        despues: { activo: false }
      });
    });
  }

  // Compartido por create() (loop de alta) y addContact(): inserta un
  // contacto y sus medios, traduciendo el UNIQUE(tipo, valor_normalizado)
  // global de medios_contacto a un 409 legible. Antes este bloque estaba
  // copiado en los dos sitios (hallazgo de code review, 14-sep-2026).
  private async insertarContactoConMedios(tx: DrizzleTx, empresaId: number, contact: ContactInput) {
    const [created] = await tx.insert(contactos).values({
      empresaId,
      nombre: contact.nombre,
      puesto: contact.puesto ?? null,
      area: contact.area ?? null,
      linkedinUrl: contact.linkedinUrl ?? null,
      facebookUrl: contact.facebookUrl ?? null,
      instagramUrl: contact.instagramUrl ?? null
    });

    try {
      await insertarMediosContacto(tx, created.insertId, buildMedioCandidatos(contact));
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw new HttpError(409, `El correo, teléfono o WhatsApp de "${contact.nombre}" ya está registrado en otro contacto`);
      }
      throw error;
    }

    return created.insertId;
  }

  // Compartido entre get() (todos los contactos de una empresa) y las
  // respuestas de updateContact (un solo contacto): no filtra por
  // estado_contacto de los medios a propósito -- el CRM necesita ver
  // también los medios 'no_contactar'/'obsoleto' de cada contacto, no solo
  // los activos.
  private async contactosConMedios(condition: SQL | undefined) {
    return this.db
      .select({
        id: contactos.id,
        empresa_id: contactos.empresaId,
        nombre: contactos.nombre,
        puesto: contactos.puesto,
        area: contactos.area,
        linkedin_url: contactos.linkedinUrl,
        facebook_url: contactos.facebookUrl,
        instagram_url: contactos.instagramUrl,
        activo: contactos.activo,
        creado_en: contactos.creadoEn,
        actualizado_en: contactos.actualizadoEn,
        medio_id: mediosContacto.id,
        medio_tipo: mediosContacto.tipo,
        medio_valor: mediosContacto.valor,
        estado_contacto: mediosContacto.estadoContacto
      })
      .from(contactos)
      .leftJoin(mediosContacto, eq(mediosContacto.contactoId, contactos.id))
      .where(condition)
      .orderBy(contactos.nombre);
  }

  // Usado por get() y update(): necesita todos los campos de la empresa
  // (get() los devuelve, update() los usa para el snapshot "antes" de
  // auditoría). `forUpdate` bloquea la fila (FOR UPDATE) hasta el commit
  // de la transacción que llama -- update() lo pide (así se serializa
  // contra un deactivate() concurrente, ver comentario ahí); get() es una
  // lectura simple y NO lo pide, para no tomar un row lock (aunque sea
  // breve) en cada GET bajo carga (hallazgo de code review, 14-sep-2026).
  private async findEmpresaScoped(db: DrizzleDb | DrizzleTx, user: CurrentUser, id: number, forUpdate = false) {
    const query = db
      .select({
        id: empresas.id,
        nombreLegal: empresas.nombreLegal,
        nombreComercial: empresas.nombreComercial,
        giro: empresas.giro,
        tamano: empresas.tamano,
        region: empresas.region,
        estado: empresas.estado,
        ciudad: empresas.ciudad,
        pais: empresas.pais,
        sitioWeb: empresas.sitioWeb,
        linkedinUrl: empresas.linkedinUrl,
        facebookUrl: empresas.facebookUrl,
        instagramUrl: empresas.instagramUrl,
        propietarioId: empresas.propietarioId,
        creadoEn: empresas.creadoEn,
        actualizadoEn: empresas.actualizadoEn
      })
      .from(empresas)
      .where(and(eq(empresas.id, id), eq(empresas.activo, true)))
      .limit(1);
    const [company] = await (forUpdate ? query.for("update") : query);

    this.assertOwnership(user, company);
    return company;
  }

  // Versión ligera de findEmpresaScoped para addContact/updateContact/
  // deactivateContact: esos tres solo necesitan confirmar que la empresa
  // existe, sigue activa y (si quien llama es agente) le pertenece -- no
  // usan ningún otro campo de la empresa, así que no tiene sentido traer
  // los otros 9 (hallazgo de code review, 14-sep-2026). También bloquea la
  // fila (FOR UPDATE) por la misma razón que findEmpresaScoped.
  private async findEmpresaOwnership(tx: DrizzleTx, user: CurrentUser, id: number) {
    const [company] = await tx
      .select({ id: empresas.id, propietarioId: empresas.propietarioId })
      .from(empresas)
      .where(and(eq(empresas.id, id), eq(empresas.activo, true)))
      .limit(1)
      .for("update");

    this.assertOwnership(user, company);
    return company;
  }

  // Regla de scoping compartida por findEmpresaScoped/findEmpresaOwnership
  // (mismo where-clause, mismo 404, solo cambian las columnas
  // seleccionadas): un agente únicamente puede operar sobre empresas de
  // las que es propietario; administrador/supervisor ven cualquiera
  // (hallazgo de code review, 14-sep-2026 -- antes esta condición estaba
  // repetida en los dos métodos).
  private assertOwnership(user: CurrentUser, company: { propietarioId: number | null } | undefined): asserts company is { propietarioId: number | null } {
    if (!company || (user.rol === "agente" && company.propietarioId !== user.id)) {
      throw new HttpError(404, "Empresa no encontrada");
    }
  }
}
