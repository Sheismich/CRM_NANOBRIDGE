import { Inject, Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, contactos, empresas, mediosContacto } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { insertarMediosContacto } from "../shared/medios-contacto.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CompanyInput } from "./dto/empresa.schema.js";

// Las respuestas siguen usando claves snake_case (nombre_legal,
// propietario_id, medio_tipo, etc.) aunque las columnas de
// src/database/schema.ts estén en camelCase: es el mismo contrato HTTP que
// ya consumen n8n y el CRM, solo cambió cómo se arman las queries por dentro.

@Injectable()
export class EmpresasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async list(user: CurrentUser, page: number, limit: number) {
    const offset = (page - 1) * limit;
    const ownsOnly = user.rol === "agente";
    const activeCondition = eq(empresas.activo, true);
    const condition = ownsOnly ? and(activeCondition, eq(empresas.propietarioId, user.id)) : activeCondition;

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
        creado_en: empresas.creadoEn
      })
      .from(empresas)
      .where(condition)
      .orderBy(empresas.nombreLegal)
      .limit(limit)
      .offset(offset);

    return { page, limit, data: rows };
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
        propietarioId: user.id
      });

      for (const contact of input.contactos) {
        const [created] = await tx.insert(contactos).values({
          empresaId: company.insertId,
          nombre: contact.nombre,
          puesto: contact.puesto ?? null,
          area: contact.area ?? null
        });

        // El UNIQUE(tipo, valor_normalizado) de medios_contacto es global
        // (no por empresa): un correo/teléfono que ya pertenece a OTRO
        // contacto (de esta empresa o de cualquier otra) revienta el
        // insert. Antes ese ER_DUP_ENTRY no se capturaba y subía como 500
        // genérico en vez de un error de validación legible (hallazgo de
        // code review, 10-sep-2026).
        try {
          await insertarMediosContacto(tx, created.insertId, [
            { tipo: "correo", valor: contact.correo, valorNormalizado: contact.correo ? normalizeEmail(contact.correo) : null },
            { tipo: "telefono", valor: contact.telefono, valorNormalizado: contact.telefono ? normalizePhone(contact.telefono) : null },
            { tipo: "whatsapp", valor: contact.whatsapp, valorNormalizado: contact.whatsapp ? normalizePhone(contact.whatsapp) : null }
          ]);
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new HttpError(409, `El correo, teléfono o WhatsApp de "${contact.nombre}" ya está registrado en otro contacto`);
          }
          throw error;
        }
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
    const [company] = await this.db
      .select({
        id: empresas.id,
        nombre_legal: empresas.nombreLegal,
        nombre_comercial: empresas.nombreComercial,
        giro: empresas.giro,
        tamano: empresas.tamano,
        region: empresas.region,
        estado: empresas.estado,
        ciudad: empresas.ciudad,
        pais: empresas.pais,
        sitio_web: empresas.sitioWeb,
        linkedin_url: empresas.linkedinUrl,
        propietario_id: empresas.propietarioId,
        activo: empresas.activo,
        creado_en: empresas.creadoEn,
        actualizado_en: empresas.actualizadoEn
      })
      .from(empresas)
      .where(and(eq(empresas.id, id), eq(empresas.activo, true)))
      .limit(1);

    if (!company || (user.rol === "agente" && company.propietario_id !== user.id)) {
      throw new HttpError(404, "Empresa no encontrada");
    }

    const contactRows = await this.db
      .select({
        id: contactos.id,
        empresa_id: contactos.empresaId,
        nombre: contactos.nombre,
        puesto: contactos.puesto,
        area: contactos.area,
        linkedin_url: contactos.linkedinUrl,
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
      .where(and(eq(contactos.empresaId, id), eq(contactos.activo, true)))
      .orderBy(contactos.nombre);

    return { ...company, contactos: contactRows };
  }
}
