import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, like } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { contactos, empresas, mediosContacto } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { EmpresasService } from "./empresas.service.js";
import type { UpdateContactInput } from "./dto/empresa.schema.js";
import type { CreateContactoInput, ListContactosQuery } from "./dto/contacto.schema.js";

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
@Injectable()
export class ContactosService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly empresasService: EmpresasService
  ) {}

  async list(user: CurrentUser, query: ListContactosQuery) {
    const offset = (query.page - 1) * query.limit;
    const condition = and(
      ...compactConditions([
        eq(contactos.activo, true),
        eq(empresas.activo, true),
        user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined,
        query.empresaId ? eq(contactos.empresaId, query.empresaId) : undefined,
        query.q ? like(contactos.nombre, `%${query.q.replace(/[\\%_]/g, "\\$&")}%`) : undefined
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

    return { page: query.page, limit: query.limit, data: await this.conMedios(rows) };
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
