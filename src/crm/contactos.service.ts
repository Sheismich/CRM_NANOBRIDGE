import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { contactos, empresas, mediosContacto } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { compactConditions, patronLike } from "../shared/drizzle-utils.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { EmpresasService } from "./empresas.service.js";
import type { UpdateContactInput } from "./dto/empresa.schema.js";
import type { ConteosContactosQuery, CreateContactoInput, ListContactosQuery } from "./dto/contacto.schema.js";

// Vista plana de los contactos (/api/v1/contactos), sobre las mismas reglas
// que ya aplica EmpresasService para /empresas/:id/contactos: las escrituras
// (alta/edición/baja) se DELEGAN a esos métodos en vez de duplicarlos, así
// las validaciones de medios de contacto, el bloqueo FOR UPDATE, el 409 por
// medio duplicado y la auditoría siguen teniendo una sola implementación.
// Lo único propio de este servicio es resolver a qué empresa pertenece el
// contacto (en la ruta anidada esa venía en la URL) y el listado.
//
// A diferencia de las respuestas de /empresas/:id (una fila por medio de
// contacto), aquí los medios van anidados en `medios`: un listado paginado
// no puede contar filas-por-medio contra `limit`.
// A quién se le puede escribir: solo cuentan los medios para escribir
// (correo, teléfono, WhatsApp), no LinkedIn ni el sitio web.
const MEDIO_PARA_ESCRIBIR = sql`${mediosContacto.tipo} IN ('correo', 'telefono', 'whatsapp')`;
const tieneMedio = (estado: "activo" | "no_contactar") =>
  sql`EXISTS (SELECT 1 FROM ${mediosContacto} WHERE ${mediosContacto.contactoId} = ${contactos.id} AND ${MEDIO_PARA_ESCRIBIR} AND ${mediosContacto.estadoContacto} = ${estado})`;
const ESCRIBIBLE = tieneMedio("activo");
const NO_CONTACTAR = sql`(NOT ${tieneMedio("activo")} AND ${tieneMedio("no_contactar")})`;
const SIN_MEDIO = sql`(NOT ${tieneMedio("activo")} AND NOT ${tieneMedio("no_contactar")})`;

@Injectable()
export class ContactosService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly empresasService: EmpresasService
  ) {}

  async list(user: CurrentUser, query: ListContactosQuery) {
    const offset = (query.page - 1) * query.limit;
    const estado = { escribible: ESCRIBIBLE, no_contactar: NO_CONTACTAR, sin_medio: SIN_MEDIO };
    const condition = and(
      ...compactConditions([
        ...this.alcanceLista(user, query.empresaId),
        query.q ? or(
          like(contactos.nombre, patronLike(query.q)),
          like(empresas.nombreLegal, patronLike(query.q)),
          like(empresas.nombreComercial, patronLike(query.q)),
          sql`EXISTS (SELECT 1 FROM ${mediosContacto} WHERE ${mediosContacto.contactoId} = ${contactos.id} AND (${mediosContacto.valor} LIKE ${patronLike(query.q)} OR ${mediosContacto.valorNormalizado} LIKE ${patronLike(query.q)}))`
        ) : undefined,
        query.estado ? estado[query.estado] : undefined
      ])
    );

    const rows = await this.db
      .select(this.contactoColumns())
      .from(contactos)
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(condition)
      .orderBy(contactos.nombre, contactos.id)
      .limit(query.limit)
      .offset(offset);

    const conMedios = await this.conMedios(rows);
    const prospeccion = await this.prospeccionPorContacto(rows.map((r) => r.id));
    return { page: query.page, limit: query.limit, data: conMedios.map((c) => ({ ...c, prospeccion: prospeccion.get(c.id) ?? null })) };
  }

  // Tarjetas de arriba de la lista de Contactos (9-oct-2026), con el mismo
  // alcance que la lista.
  async conteos(user: CurrentUser, query: ConteosContactosQuery) {
    const [fila] = await this.db
      .select({
        total: sql<number>`COUNT(*)`.mapWith(Number),
        escribibles: sql<number>`COALESCE(SUM(${ESCRIBIBLE}), 0)`.mapWith(Number),
        noContactar: sql<number>`COALESCE(SUM(${NO_CONTACTAR}), 0)`.mapWith(Number),
        sinMedio: sql<number>`COALESCE(SUM(${SIN_MEDIO}), 0)`.mapWith(Number)
      })
      .from(contactos)
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(and(...compactConditions(this.alcanceLista(user, query.empresaId))));
    return { total: fila.total, escribibles: fila.escribibles, no_contactar: fila.noContactar, sin_medio: fila.sinMedio };
  }

  private alcanceLista(user: CurrentUser, empresaId?: number) {
    return [
      eq(contactos.activo, true),
      eq(empresas.activo, true),
      user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined,
      empresaId ? eq(contactos.empresaId, empresaId) : undefined
    ];
  }

  // En qué va cada persona (lista de Contactos, 9-oct-2026): estado de su
  // prospecto más reciente y cuántos correos lleva; null si nunca fue
  // prospecto. Una consulta para toda la página.
  private async prospeccionPorContacto(ids: number[]) {
    const resultado = new Map<number, { estado: string; envios: number }>();
    if (ids.length === 0) return resultado;
    const lista = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const [filas] = (await this.db.execute(sql`SELECT contacto_id, estado, envios FROM (
        SELECT p.contacto_id, p.estado, (SELECT COUNT(*) FROM envios e WHERE e.prospecto_id = p.id) AS envios,
               ROW_NUMBER() OVER (PARTITION BY p.contacto_id ORDER BY p.id DESC) AS n
        FROM prospectos p WHERE p.contacto_id IN (${lista})) t WHERE n = 1`)) as unknown as [{ contacto_id: number; estado: string; envios: number }[]];
    for (const f of filas) resultado.set(Number(f.contacto_id), { estado: f.estado, envios: Number(f.envios) });
    return resultado;
  }

  async get(user: CurrentUser, id: number) {
    const [row] = await this.db
      .select(this.contactoColumns())
      .from(contactos)
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(this.alcance(user, id))
      .limit(1);
    if (!row) throw new HttpError(404, "Contacto no encontrado");

    const [contacto] = await this.conMedios([row]);
    return contacto;
  }

  async create(user: CurrentUser, input: CreateContactoInput) {
    const { empresaId, ...contacto } = input;
    return this.empresasService.addContact(user, empresaId, contacto);
  }

  async update(user: CurrentUser, id: number, input: UpdateContactInput) {
    const empresaId = await this.resolverEmpresaId(user, id);
    await this.empresasService.updateContact(user, empresaId, id, input);
    return this.get(user, id);
  }

  async deactivate(user: CurrentUser, id: number) {
    const empresaId = await this.resolverEmpresaId(user, id);
    await this.empresasService.deactivateContact(user, empresaId, id);
  }

  // Contacto activo, de una empresa activa y (si quien llama es agente) de
  // una empresa suya. Un contacto ajeno responde 404 igual que uno
  // inexistente -- mismo criterio que EmpresasService.assertOwnership: no se
  // revela que existe.
  private alcance(user: CurrentUser, id: number) {
    return and(
      ...compactConditions([
        eq(contactos.id, id),
        eq(contactos.activo, true),
        eq(empresas.activo, true),
        user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined
      ])
    );
  }

  private async resolverEmpresaId(user: CurrentUser, id: number) {
    const [row] = await this.db
      .select({ empresaId: contactos.empresaId })
      .from(contactos)
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(this.alcance(user, id))
      .limit(1);
    if (!row) throw new HttpError(404, "Contacto no encontrado");
    return row.empresaId;
  }

  private contactoColumns() {
    return {
      id: contactos.id,
      empresa_id: contactos.empresaId,
      empresa_nombre: empresas.nombreLegal,
      nombre: contactos.nombre,
      puesto: contactos.puesto,
      area: contactos.area,
      linkedin_url: contactos.linkedinUrl,
      facebook_url: contactos.facebookUrl,
      instagram_url: contactos.instagramUrl,
      creado_en: contactos.creadoEn,
      actualizado_en: contactos.actualizadoEn
    };
  }

  // No filtra por estado_contacto a propósito -- mismo criterio que
  // EmpresasService.contactosConMedios: el CRM necesita ver también los
  // medios 'no_contactar'/'obsoleto', no solo los activos.
  private async conMedios<T extends { id: number }>(rows: T[]) {
    if (rows.length === 0) return [];

    const medios = await this.db
      .select({
        contacto_id: mediosContacto.contactoId,
        id: mediosContacto.id,
        tipo: mediosContacto.tipo,
        valor: mediosContacto.valor,
        estado_contacto: mediosContacto.estadoContacto
      })
      .from(mediosContacto)
      .where(
        inArray(
          mediosContacto.contactoId,
          rows.map((row) => row.id)
        )
      )
      .orderBy(mediosContacto.id);

    return rows.map((row) => ({
      ...row,
      medios: medios
        .filter((medio) => medio.contacto_id === row.id)
        .map((medio) => ({ id: medio.id, tipo: medio.tipo, valor: medio.valor, estado_contacto: medio.estado_contacto }))
    }));
  }
}
