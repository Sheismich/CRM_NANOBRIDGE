import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, empresas, envios, incidencias, listaSupresion, mediosContacto, parametrosAutomatizacion, prospectos, resultadosScoring } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import type { CampanaActivaQuery, ConsultaProspectoScoringQuery, ConsultaSupresionQuery, EstadoProspectoInput, IncidenciaInput, RegistroEnvioInput, RegistroProspectoInput, RegistroSupresionInput, ScoringInput, ValidacionInput, VerificacionEnvioQuery } from "./dto/automatizacion.schema.js";

function normalizarValor(tipo: "correo" | "telefono" | "whatsapp", valor: string): string {
  return tipo === "correo" ? normalizeEmail(valor) : normalizePhone(valor);
}

// Política de contactos (PLAN_N8N_DEFINITIVO.md): "cinco días hábiles de
// espera" entre un envío y el siguiente. Solo descuenta sábado/domingo —
// no hay calendario de festivos definido en ningún plan todavía.
function addBusinessDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return result;
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

  // --- Consulta de prospecto para scoring ---------------------------------------
  // B2 (PLAN_API_DEFINITIVO.md #14): datos firmográficos para que n8n arme
  // el prompt de Gemini. Deliberadamente no incluye correo ni teléfono
  // (viven en medios_contacto, tabla que este método ni siquiera toca) —
  // regla dura de PLAN_N8N_DEFINITIVO.md: "nunca enviar correo, teléfono,
  // descripción libre o documentos a Gemini".
  async consultarProspectoParaScoring(query: ConsultaProspectoScoringQuery) {
    const [row] = await this.db
      .select({
        estado: prospectos.estado,
        fuenteUrl: prospectos.fuenteUrl,
        confianza: prospectos.confianza,
        contactoNombre: contactos.nombre,
        contactoPuesto: contactos.puesto,
        contactoArea: contactos.area,
        empresaNombreLegal: empresas.nombreLegal,
        empresaNombreComercial: empresas.nombreComercial,
        empresaGiro: empresas.giro,
        empresaTamano: empresas.tamano,
        empresaRegion: empresas.region,
        empresaEstado: empresas.estado,
        empresaCiudad: empresas.ciudad,
        empresaPais: empresas.pais,
        empresaSitioWeb: empresas.sitioWeb,
        empresaLinkedinUrl: empresas.linkedinUrl
      })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(eq(prospectos.id, query.prospecto_id))
      .limit(1);
    if (!row) throw new HttpError(404, "Prospecto no encontrado");

    return {
      prospecto_id: query.prospecto_id,
      estado: row.estado,
      fuente_url: row.fuenteUrl,
      confianza: row.confianza,
      contacto: { nombre: row.contactoNombre, puesto: row.contactoPuesto, area: row.contactoArea },
      empresa: {
        nombre_legal: row.empresaNombreLegal,
        nombre_comercial: row.empresaNombreComercial,
        giro: row.empresaGiro,
        tamano: row.empresaTamano,
        region: row.empresaRegion,
        estado: row.empresaEstado,
        ciudad: row.empresaCiudad,
        pais: row.empresaPais,
        sitio_web: row.empresaSitioWeb,
        linkedin_url: row.empresaLinkedinUrl
      }
    };
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

  // --- Verificación de envío ----------------------------------------------------------
  // B1, paso 9 (PLAN_N8N_DEFINITIVO.md): gate antes de enviar. Bloquea por
  // canal apagado (política de contactos: WhatsApp sigue desactivado hasta
  // tener proveedor aprobado), por máximo de 3 contactos totales (envío
  // inicial + dos recordatorios), o por una ventana de espera del último
  // envío que sigue abierta y vigente.
  async verificarEnvio(query: VerificacionEnvioQuery) {
    if (query.canal === "whatsapp") {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "Canal WhatsApp desactivado (pendiente proveedor aprobado)", numero_contacto_siguiente: null, ventana_vence_en: null };
    }

    const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, query.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    const [ultimo] = await this.db
      .select({ numeroContacto: envios.numeroContacto, ventanaVenceEn: envios.ventanaVenceEn, ventanaEstado: envios.ventanaEstado })
      .from(envios)
      .where(and(eq(envios.prospectoId, query.prospecto_id), eq(envios.canal, query.canal)))
      .orderBy(desc(envios.numeroContacto))
      .limit(1);

    const total = ultimo?.numeroContacto ?? 0;

    if (total >= 3) {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "Máximo de 3 contactos alcanzado", numero_contacto_siguiente: null, ventana_vence_en: null };
    }

    if (ultimo && ultimo.ventanaEstado === "abierta" && ultimo.ventanaVenceEn > new Date()) {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "Ventana de espera activa", numero_contacto_siguiente: total + 1, ventana_vence_en: ultimo.ventanaVenceEn };
    }

    return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: true, motivo: null, numero_contacto_siguiente: total + 1, ventana_vence_en: null };
  }

  // --- Registro de envío --------------------------------------------------------------
  // B1, paso 12. Abre una nueva ventana de espera de 5 días hábiles
  // (B0, punto 3: "crear ventanas de espera al registrar envíos").
  // numero_contacto se recalcula en el servidor en vez de confiar en lo
  // que mande n8n, para no desincronizarse de Verificación de envío si
  // algo se salta el orden del flujo.
  async registrarEnvio(input: RegistroEnvioInput) {
    const [existing] = await this.db
      .select({ id: envios.id, numeroContacto: envios.numeroContacto, ventanaVenceEn: envios.ventanaVenceEn })
      .from(envios)
      .where(eq(envios.executionId, input.execution_id))
      .limit(1);
    if (existing) return { id: existing.id, numero_contacto: existing.numeroContacto, ventana_vence_en: existing.ventanaVenceEn, ya_existia: true as const };

    if (input.canal === "whatsapp") {
      throw new HttpError(409, "Canal WhatsApp desactivado (pendiente proveedor aprobado)");
    }

    const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    const [ultimo] = await this.db
      .select({ numeroContacto: envios.numeroContacto })
      .from(envios)
      .where(and(eq(envios.prospectoId, input.prospecto_id), eq(envios.canal, input.canal)))
      .orderBy(desc(envios.numeroContacto))
      .limit(1);

    const total = ultimo?.numeroContacto ?? 0;
    if (total >= 3) throw new HttpError(409, "Máximo de 3 contactos alcanzado para este prospecto y canal");

    const ventanaVenceEn = addBusinessDays(new Date(), 5);

    try {
      const [result] = await this.db.insert(envios).values({
        prospectoId: input.prospecto_id,
        canal: input.canal,
        numeroContacto: total + 1,
        ventanaVenceEn,
        executionId: input.execution_id
      });
      return { id: result.insertId, numero_contacto: total + 1, ventana_vence_en: ventanaVenceEn, ya_existia: false as const };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [retry] = await this.db
          .select({ id: envios.id, numeroContacto: envios.numeroContacto, ventanaVenceEn: envios.ventanaVenceEn })
          .from(envios)
          .where(eq(envios.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, numero_contacto: retry.numeroContacto, ventana_vence_en: retry.ventanaVenceEn, ya_existia: true as const };
      }
      throw error;
    }
  }

  // --- Campaña activa ----------------------------------------------------------------
  // B1, paso previo a "Registro de envío" (PLAN_N8N_DEFINITIVO.md): n8n
  // consulta esto justo antes de disparar un envío para no seguir
  // mandando mensajes de una campaña que ya se pausó o finalizó después de
  // que el prospecto entró al flujo. `activa` combina el campo `estado`
  // con `fecha_fin`: una campaña puede seguir marcada "activa" en la BD
  // porque nadie la cerró a tiempo, pero si ya pasó su fecha de fin no
  // debe seguir enviando.
  async consultarCampanaActiva(query: CampanaActivaQuery) {
    const [row] = await this.db
      .select({ nombre: campanas.nombre, estado: campanas.estado, fechaFin: campanas.fechaFin })
      .from(campanas)
      .where(eq(campanas.id, query.campana_id))
      .limit(1);
    if (!row) throw new HttpError(404, "Campaña no encontrada");

    const hoy = new Date().toISOString().slice(0, 10);
    const activa = row.estado === "activa" && (!row.fechaFin || row.fechaFin >= hoy);

    return { campana_id: query.campana_id, nombre: row.nombre, estado: row.estado, activa };
  }

  // --- Consulta de supresión -------------------------------------------------------
  // B1, paso 8: "verificar antes de enviar" (PLAN_API_DEFINITIVO.md).
  async consultarSupresion(query: ConsultaSupresionQuery) {
    const valorNormalizado = normalizarValor(query.tipo, query.valor);
    const [row] = await this.db
      .select({ motivo: listaSupresion.motivo })
      .from(listaSupresion)
      .where(and(eq(listaSupresion.tipo, query.tipo), eq(listaSupresion.valorNormalizado, valorNormalizado)))
      .limit(1);

    return { en_supresion: !!row, motivo: row?.motivo ?? null };
  }

  // --- Registro de supresión ---------------------------------------------------------
  // B2: se invoca al procesar una respuesta clasificada como "baja" o
  // "no_contactar" (PLAN_N8N_DEFINITIVO.md). La baja aplica al medio de
  // contacto específico, no a toda la empresa (PLAN_CRM_DEFINITIVO.md,
  // decisiones de diseño cerradas) — por eso también actualiza el
  // medios_contacto correspondiente si ya existe uno, además de dejar el
  // registro en lista_supresion (que persiste aunque ese medio no exista
  // todavía o el contacto se borre después).
  async registrarSupresion(input: RegistroSupresionInput) {
    const valorNormalizado = normalizarValor(input.tipo, input.valor);

    try {
      const [result] = await this.db.insert(listaSupresion).values({
        tipo: input.tipo,
        valorNormalizado,
        motivo: input.motivo,
        executionId: input.execution_id
      });

      await this.db.update(mediosContacto).set({ estadoContacto: "no_contactar" }).where(and(eq(mediosContacto.tipo, input.tipo), eq(mediosContacto.valorNormalizado, valorNormalizado)));

      await this.db.insert(auditoria).values({
        usuarioId: null,
        entidad: "medio_contacto",
        entidadId: result.insertId,
        accion: "registrar_supresion",
        despues: { execution_id: input.execution_id, tipo: input.tipo, motivo: input.motivo }
      });

      return { id: result.insertId, ya_existia: false as const };
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [existing] = await this.db
          .select({ id: listaSupresion.id })
          .from(listaSupresion)
          .where(and(eq(listaSupresion.tipo, input.tipo), eq(listaSupresion.valorNormalizado, valorNormalizado)))
          .limit(1);
        if (existing) return { id: existing.id, ya_existia: true as const };
      }
      throw error;
    }
  }
}
