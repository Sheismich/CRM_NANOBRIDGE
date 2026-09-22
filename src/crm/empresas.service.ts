import { Inject, Injectable } from "@nestjs/common";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, contactos, empresas, mediosContacto } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { buildAntes } from "../shared/drizzle-utils.js";
import { insertarMediosContacto, buildMedioCandidatos } from "../shared/medios-contacto.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import type { CompanyInput, ContactInput, UpdateCompanyInput, UpdateContactInput } from "./dto/empresa.schema.js";

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
            await tx.update(mediosContacto).set({ valor: medio.valor, valorNormalizado, estadoContacto: "activo" }).where(eq(mediosContacto.id, existing.id));
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
      // que limpia el único medio activo dejaba el contacto sin ninguna
      // forma de contactarlo, algo que crear() nunca permitió (hallazgo de
      // code review, 14-sep-2026).
      const [{ activos }] = await tx
        .select({ activos: sql<number>`count(*)` })
        .from(mediosContacto)
        .where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.estadoContacto, "activo")));
      if (Number(activos) === 0) {
        throw new HttpError(409, "El contacto debe conservar al menos un medio de contacto activo");
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
