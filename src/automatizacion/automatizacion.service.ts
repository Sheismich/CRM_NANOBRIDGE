import { Inject, Injectable } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, empresas, incidencias, mediosContacto, parametrosAutomatizacion, prospectos, resultadosScoring } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import type { EstadoProspectoInput, IncidenciaInput, RegistroProspectoInput, ScoringInput, ValidacionInput } from "./dto/automatizacion.schema.js";

function isDuplicateEntry(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ER_DUP_ENTRY";
}

// Catálogos derivados en vivo de los ENUM ya declarados en las migraciones
// (INFORMATION_SCHEMA), para que nunca se desincronicen de una lista
// hardcodeada por separado.
const CATALOGOS: Record<string, { tabla: string; columna: string }> = {
  tamano_empresa: { tabla: "empresas", columna: "tamano" },
  tipo_medio_contacto: { tabla: "medios_contacto", columna: "tipo" },
  estado_medio_contacto: { tabla: "medios_contacto", columna: "estado_contacto" },
  prioridad_prospecto: { tabla: "prospectos", columna: "prioridad" },
  confianza_scoring: { tabla: "resultados_scoring", columna: "confianza" },
  metodo_scoring: { tabla: "resultados_scoring", columna: "metodo" },
  canal_campana: { tabla: "campanas", columna: "canal" },
  estado_campana: { tabla: "campanas", columna: "estado" },
  tarea_tipo: { tabla: "tareas", columna: "tipo" },
  tarea_prioridad: { tabla: "tareas", columna: "prioridad" }
};

function parseEnumValues(columnType: string): string[] {
  const match = /^enum\((.*)\)$/i.exec(columnType.trim());
  if (!match) return [];
  return match[1]!.split(",").map((value) => value.trim().replace(/^'|'$/g, "").replace(/''/g, "'"));
}

@Injectable()
export class AutomatizacionService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // --- Parámetros ----------------------------------------------------------
  async obtenerParametros() {
    const rows = await this.db.select({ clave: parametrosAutomatizacion.clave, valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion);
    return Object.fromEntries(rows.map((row) => [row.clave, row.valor]));
  }

  // --- Catálogos -------------------------------------------------------------
  async obtenerCatalogos() {
    const entries = Object.entries(CATALOGOS);
    const conditions = entries.map(([, { tabla, columna }]) => sql`(TABLE_NAME = ${tabla} AND COLUMN_NAME = ${columna})`);
    const [rows] = await this.db.execute<{ tabla: string; columna: string; tipo: string }[]>(sql`
      SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLUMN_TYPE AS tipo
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND (${sql.join(conditions, sql` OR `)})
    `) as unknown as [{ tabla: string; columna: string; tipo: string }[], unknown];

    return Object.fromEntries(
      entries.map(([nombre, { tabla, columna }]) => {
        const row = rows.find((candidate) => candidate.tabla === tabla && candidate.columna === columna);
        return [nombre, row ? parseEnumValues(row.tipo) : []];
      })
    );
  }

  // --- Scoring -----------------------------------------------------------------
  async registrarScoring(input: ScoringInput) {
    const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    try {
      return await this.db.transaction(async (tx) => {
        const [result] = await tx.insert(resultadosScoring).values({
          executionId: input.execution_id,
          prospectoId: input.prospecto_id,
          score: input.score.toFixed(2),
          prioridad: input.prioridad ?? null,
          confianza: input.confianza ?? null,
          metodo: input.metodo,
          detalle: input.detalle ?? null
        });

        await tx.update(prospectos).set({
          score: input.score.toFixed(2),
          ...(input.prioridad ? { prioridad: input.prioridad } : {}),
          ...(input.confianza ? { confianza: input.confianza } : {})
        }).where(eq(prospectos.id, input.prospecto_id));

        return { id: result.insertId, ya_existia: false as const };
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [existing] = await this.db.select({ id: resultadosScoring.id }).from(resultadosScoring).where(eq(resultadosScoring.executionId, input.execution_id)).limit(1);
        if (existing) return { id: existing.id, ya_existia: true as const };
      }
      throw error;
    }
  }

  // --- Incidencias -------------------------------------------------------------
  async registrarIncidencia(input: IncidenciaInput) {
    if (input.prospecto_id) {
      const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
      if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");
    }

    try {
      const [result] = await this.db.insert(incidencias).values({
        executionId: input.execution_id ?? null,
        prospectoId: input.prospecto_id ?? null,
        tipo: input.tipo,
        severidad: input.severidad,
        mensaje: input.mensaje,
        detalle: input.detalle ?? null
      });
      return { id: result.insertId, ya_existia: false as const };
    } catch (error) {
      if (isDuplicateEntry(error) && input.execution_id) {
        const [existing] = await this.db
          .select({ id: incidencias.id })
          .from(incidencias)
          .where(sql`${incidencias.executionId} = ${input.execution_id} AND ${incidencias.tipo} = ${input.tipo}`)
          .limit(1);
        if (existing) return { id: existing.id, ya_existia: true as const };
      }
      throw error;
    }
  }

  // --- Registro de prospecto ----------------------------------------------------
  // Deduplica por correo normalizado y, si no hay coincidencia, por teléfono
  // normalizado del CONTACTO — nunca por razón social de la empresa (regla
  // explícita de PLAN_CRM_DEFINITIVO.md). Idempotente por execution_id.
  async registrarProspecto(input: RegistroProspectoInput) {
    const [existing] = await this.db
      .select({ id: prospectos.id, contactoId: prospectos.contactoId, empresaId: contactos.empresaId })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .where(eq(prospectos.executionId, input.execution_id))
      .limit(1);
    if (existing) return { id: existing.id, contacto_id: existing.contactoId, empresa_id: existing.empresaId, duplicado: false, ya_existia: true as const };

    if (input.campana_id) {
      const [campana] = await this.db.select({ id: campanas.id }).from(campanas).where(eq(campanas.id, input.campana_id)).limit(1);
      if (!campana) throw new HttpError(404, "Campaña no encontrada");
    }

    const correoNormalizado = input.contacto.correo ? normalizeEmail(input.contacto.correo) : null;
    const telefonoNormalizado = input.contacto.telefono ? normalizePhone(input.contacto.telefono) : null;

    try {
      return await this.db.transaction(async (tx) => {
        // Coincidencia existente de correo o teléfono, sin importar si el
        // contacto está activo: el UNIQUE(tipo, valor_normalizado) de
        // medios_contacto es global, así que reusar aquí evita chocar con
        // esa restricción al intentar insertar el mismo valor de nuevo.
        const matches = await tx
          .select({ contactoId: contactos.id, empresaId: contactos.empresaId, esCorreo: sql<number>`(${mediosContacto.tipo} = 'correo')` })
          .from(mediosContacto)
          .innerJoin(contactos, eq(contactos.id, mediosContacto.contactoId))
          .where(sql`(${mediosContacto.tipo} = 'correo' AND ${mediosContacto.valorNormalizado} = ${correoNormalizado}) OR (${mediosContacto.tipo} = 'telefono' AND ${mediosContacto.valorNormalizado} = ${telefonoNormalizado})`)
          .orderBy(sql`(${mediosContacto.tipo} = 'correo') DESC`)
          .limit(1);

        let contactoId: number;
        let empresaId: number;
        const duplicado = matches.length > 0;

        if (duplicado) {
          contactoId = matches[0]!.contactoId;
          empresaId = matches[0]!.empresaId;
        } else {
          const [company] = await tx.insert(empresas).values({
            nombreLegal: input.empresa.nombreLegal,
            nombreComercial: input.empresa.nombreComercial ?? null,
            giro: input.empresa.giro ?? null,
            tamano: input.empresa.tamano ?? null,
            region: input.empresa.region ?? null,
            estado: input.empresa.estado ?? null,
            ciudad: input.empresa.ciudad ?? null,
            pais: input.empresa.pais.toUpperCase(),
            sitioWeb: input.empresa.sitioWeb ?? null,
            linkedinUrl: input.empresa.linkedinUrl ?? null
          });
          empresaId = company.insertId;

          const [contact] = await tx.insert(contactos).values({
            empresaId,
            nombre: input.contacto.nombre,
            puesto: input.contacto.puesto ?? null,
            area: input.contacto.area ?? null
          });
          contactoId = contact.insertId;

          const medios = [["correo", input.contacto.correo, correoNormalizado] as const, ["telefono", input.contacto.telefono, telefonoNormalizado] as const];
          for (const [tipo, valor, normalizado] of medios) {
            if (valor && normalizado) {
              await tx.insert(mediosContacto).values({ contactoId, tipo, valor, valorNormalizado: normalizado, esPrincipal: tipo === "correo" });
            }
          }
        }

        const [prospecto] = await tx.insert(prospectos).values({
          contactoId,
          campanaId: input.campana_id ?? null,
          executionId: input.execution_id,
          estado: "capturado",
          fuenteUrl: input.fuente_url ?? null,
          confianza: input.confianza ?? null
        });

        await tx.insert(auditoria).values({
          usuarioId: null,
          entidad: "prospecto",
          entidadId: prospecto.insertId,
          accion: "registrar_automatizacion",
          despues: { execution_id: input.execution_id, contacto_id: contactoId, empresa_id: empresaId, duplicado }
        });

        return { id: prospecto.insertId, contacto_id: contactoId, empresa_id: empresaId, duplicado, ya_existia: false as const };
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [retry] = await this.db
          .select({ id: prospectos.id, contactoId: prospectos.contactoId, empresaId: contactos.empresaId })
          .from(prospectos)
          .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
          .where(eq(prospectos.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, contacto_id: retry.contactoId, empresa_id: retry.empresaId, duplicado: false, ya_existia: true as const };
      }
      throw error;
    }
  }

  // --- Validaciones --------------------------------------------------------------
  async validarProspecto(input: ValidacionInput) {
    const [row] = await this.db
      .select({ id: prospectos.id, contactoId: prospectos.contactoId, empresaId: contactos.empresaId, giro: empresas.giro, tamano: empresas.tamano })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(eq(prospectos.id, input.prospecto_id))
      .limit(1);
    if (!row) throw new HttpError(404, "Prospecto no encontrado");

    const medios = await this.db
      .select({ id: mediosContacto.id })
      .from(mediosContacto)
      .where(sql`${mediosContacto.estadoContacto} = 'activo' AND ${mediosContacto.tipo} IN ('correo', 'telefono', 'whatsapp') AND (${mediosContacto.contactoId} = ${row.contactoId} OR ${mediosContacto.empresaId} = ${row.empresaId})`);

    const motivos: string[] = [];
    if (medios.length === 0) motivos.push("sin_medio_de_contacto_activo");
    if (!row.giro) motivos.push("giro_no_informado");
    if (!row.tamano) motivos.push("tamano_no_informado");

    const valido = motivos.length === 0;
    const estado = valido ? "validado" : "excluido";

    await this.db.update(prospectos).set({ estado }).where(eq(prospectos.id, input.prospecto_id));
    await this.db.insert(auditoria).values({
      usuarioId: null,
      entidad: "prospecto",
      entidadId: input.prospecto_id,
      accion: "validar_automatizacion",
      despues: { execution_id: input.execution_id, valido, motivos, estado }
    });

    return { id: input.prospecto_id, valido, motivos, estado };
  }

  // --- Estado de prospecto -------------------------------------------------------
  async actualizarEstadoProspecto(input: EstadoProspectoInput) {
    const [prospecto] = await this.db.select({ id: prospectos.id, estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    await this.db.update(prospectos).set({ estado: input.estado }).where(eq(prospectos.id, input.prospecto_id));
    await this.db.insert(auditoria).values({
      usuarioId: null,
      entidad: "prospecto",
      entidadId: input.prospecto_id,
      accion: "cambiar_estado_automatizacion",
      antes: { estado: prospecto.estado },
      despues: { execution_id: input.execution_id, estado: input.estado, motivo: input.motivo }
    });

    return { id: input.prospecto_id, estado: input.estado, motivo: input.motivo };
  }
}
