import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, lte, ne, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, empresas, envios, incidencias, listaSupresion, mediosContacto, parametrosAutomatizacion, procesosFallidos, prospectos, respuestas, resultadosScoring } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { insertarMediosContacto } from "../shared/medios-contacto.js";
import { normalizarValorSupresion, registrarSupresion, suprimirMediosDelProspecto } from "../shared/supresion.js";
import { ESTADO_PROSPECTO_POR_CLASIFICACION } from "../shared/clasificacion-respuesta.js";
import { obtenerCatalogosEnum } from "../shared/catalogos-enum.js";
import { TareasService } from "../tareas/tareas.service.js";
import type { CampanaActivaQuery, ConsultaProspectoScoringQuery, ConsultaSupresionQuery, ErrorWorkflowInput, EstadoProspectoInput, IncidenciaInput, RegistroEnvioInput, RegistroProspectoInput, RegistroSupresionInput, RespuestaClasificadaInput, RespuestaRecibidaInput, ScoringInput, ValidacionInput, VentanasVencidasQuery, VerificacionEnvioQuery } from "./dto/automatizacion.schema.js";

// tipo fijo de incidencias.tipo para todo lo que reporta el Error Workflow
// global de n8n (B4) — junto con execution_id es la pareja que usa el
// UNIQUE uq_incidencias_execution_tipo (004_scoring_e_incidencias.sql)
// para que registrarErrorWorkflow() sea idempotente.
const TIPO_ERROR_WORKFLOW = "error_workflow_n8n";

// Política de contactos (PLAN_N8N_DEFINITIVO.md): máximo tres contactos
// totales POR PERSONA (contacto), no por prospecto -- la misma persona
// puede entrar varias veces al flujo de ingesta y cada entrada crea un
// prospecto nuevo. Tras MESES_ENFRIAMIENTO sin ningún contacto, la persona
// puede arrancar un ciclo nuevo (decisión de negocio, 23-sep-2026).
const MAX_CONTACTOS_POR_CICLO = 3;
const MESES_ENFRIAMIENTO = 6;

function sumarMeses(fecha: Date, meses: number): Date {
  const result = new Date(fecha);
  result.setMonth(result.getMonth() + meses);
  return result;
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

@Injectable()
export class AutomatizacionService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    private readonly tareasService: TareasService
  ) {}

  // --- Parámetros ----------------------------------------------------------
  async obtenerParametros() {
    const rows = await this.db.select({ clave: parametrosAutomatizacion.clave, valor: parametrosAutomatizacion.valor }).from(parametrosAutomatizacion);
    return Object.fromEntries(rows.map((row) => [row.clave, row.valor]));
  }

  // --- Catálogos -------------------------------------------------------------
  async obtenerCatalogos() {
    return obtenerCatalogosEnum(this.db);
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

  // --- Error de workflow (B4, PLAN_N8N_DEFINITIVO.md) -----------------------------
  // El Error Trigger global de n8n llama esto UNA vez por ejecución fallida
  // en vez de dos llamadas condicionales separadas (registrar incidencia +
  // tal vez registrar procesos_fallidos) -- por eso ambas escrituras pasan
  // por la misma transacción aquí: o quedan las dos, o ninguna. `critico`
  // decide si además de la incidencia (que siempre se registra, para dejar
  // rastro de todo lo que falla) se crea una fila en procesos_fallidos, la
  // que sí exige triage humano.
  async registrarErrorWorkflow(input: ErrorWorkflowInput) {
    if (input.prospecto_id) {
      const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
      if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");
    }

    // Un solo objeto para ambas escrituras (única fuente de verdad): así
    // el contexto crudo que manda n8n en `detalle` no se pierde de una
    // tabla sin perderse de la otra.
    const detalle = {
      ...input.detalle,
      workflow: input.workflow ?? null,
      nodo: input.nodo ?? null,
      endpoint: input.endpoint ?? null,
      codigo_http: input.codigo_http ?? null
    };

    try {
      return await this.db.transaction(async (tx) => {
        const [incidencia] = await tx.insert(incidencias).values({
          executionId: input.execution_id,
          prospectoId: input.prospecto_id ?? null,
          tipo: TIPO_ERROR_WORKFLOW,
          severidad: input.critico ? "alta" : "media",
          mensaje: input.mensaje,
          detalle
        });

        let procesoFallidoId: number | null = null;
        if (input.critico) {
          const [proceso] = await tx.insert(procesosFallidos).values({
            executionId: input.execution_id,
            tipo: TIPO_ERROR_WORKFLOW,
            workflow: input.workflow ?? null,
            nodo: input.nodo ?? null,
            endpoint: input.endpoint ?? null,
            codigoHttp: input.codigo_http ?? null,
            mensaje: input.mensaje,
            payload: detalle
          });
          procesoFallidoId = proceso.insertId;
        }

        return { incidencia_id: incidencia.insertId, proceso_fallido_id: procesoFallidoId, ya_existia: false as const };
      });
    } catch (error) {
      if (!isDuplicateEntry(error)) throw error;

      const [existing] = await this.db
        .select({ id: incidencias.id })
        .from(incidencias)
        .where(sql`${incidencias.executionId} = ${input.execution_id} AND ${incidencias.tipo} = ${TIPO_ERROR_WORKFLOW}`)
        .limit(1);
      if (!existing) throw error;

      const [existingProceso] = await this.db
        .select({ id: procesosFallidos.id })
        .from(procesosFallidos)
        .where(eq(procesosFallidos.executionId, input.execution_id))
        .limit(1);

      // Promoción (hallazgo de code review, 14-sep-2026): un segundo
      // reporte para el mismo execution_id (reintento de n8n, u otro nodo
      // de la misma ejecución que sí resultó crítico) no debe perderse en
      // silencio solo porque el (execution_id, tipo) ya existía. Si este
      // reporte llega marcado crítico y todavía no hay fila en
      // procesos_fallidos, se crea ahora y se sube la severidad de la
      // incidencia ya existente -- así una promoción tardía a crítico
      // sigue generando la fila que exige triage humano, en vez de
      // devolver silenciosamente proceso_fallido_id: null.
      if (input.critico && !existingProceso) {
        try {
          return await this.db.transaction(async (tx) => {
            const [proceso] = await tx.insert(procesosFallidos).values({
              executionId: input.execution_id,
              tipo: TIPO_ERROR_WORKFLOW,
              workflow: input.workflow ?? null,
              nodo: input.nodo ?? null,
              endpoint: input.endpoint ?? null,
              codigoHttp: input.codigo_http ?? null,
              mensaje: input.mensaje,
              payload: detalle
            });
            await tx.update(incidencias).set({ severidad: "alta" }).where(eq(incidencias.id, existing.id));
            return { incidencia_id: existing.id, proceso_fallido_id: proceso.insertId, ya_existia: true as const };
          });
        } catch (promotionError) {
          // Carrera rarísima: dos promociones concurrentes para el mismo
          // execution_id. uq_procesos_fallidos_execution_id ya garantizó
          // que solo una ganó -- se resuelve como una idempotencia más en
          // vez de burbujear un 500.
          if (!isDuplicateEntry(promotionError)) throw promotionError;
          const [raceWinner] = await this.db
            .select({ id: procesosFallidos.id })
            .from(procesosFallidos)
            .where(eq(procesosFallidos.executionId, input.execution_id))
            .limit(1);
          if (raceWinner) return { incidencia_id: existing.id, proceso_fallido_id: raceWinner.id, ya_existia: true as const };
          throw promotionError;
        }
      }

      return { incidencia_id: existing.id, proceso_fallido_id: existingProceso?.id ?? null, ya_existia: true as const };
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

    // Reintento acotado: un ER_DUP_ENTRY aquí puede ser (a) nuestro propio
    // execution_id insertado por una llamada concurrente idéntica -- el
    // retry-lookup de abajo lo resuelve -- o (b) el UNIQUE(tipo,
    // valor_normalizado) de medios_contacto chocando con OTRA ejecución
    // (execution_id distinto) que registró el mismo correo/teléfono justo
    // entre nuestro pre-check de "matches" y el insert. Antes, (b) no tenía
    // manejo: el retry-lookup por execution_id no encontraba nada (nuestro
    // propio insert de prospecto también hizo rollback) y el error subía
    // como 500 en vez de degradar a duplicado:true (hallazgo de code
    // review, 10-sep-2026). Reintentar la transacción completa resuelve
    // (b): en la siguiente vuelta, el pre-check de "matches" ya ve el
    // contacto recién comprometido por la otra ejecución y toma la rama de
    // deduplicado en vez de volver a intentar el insert.
    const MAX_INTENTOS = 2;
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
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

            await insertarMediosContacto(tx, contactoId, [
              { tipo: "correo", valor: input.contacto.correo, valorNormalizado: correoNormalizado },
              { tipo: "telefono", valor: input.contacto.telefono, valorNormalizado: telefonoNormalizado }
            ]);
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
        if (!isDuplicateEntry(error)) throw error;

        const [retry] = await this.db
          .select({ id: prospectos.id, contactoId: prospectos.contactoId, empresaId: contactos.empresaId })
          .from(prospectos)
          .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
          .where(eq(prospectos.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, contacto_id: retry.contactoId, empresa_id: retry.empresaId, duplicado: false, ya_existia: true as const };

        if (intento === MAX_INTENTOS) throw error;
        // No fue nuestro propio execution_id -- fue el UNIQUE de
        // medios_contacto contra otra ejecución concurrente. Se reintenta
        // la transacción completa en la siguiente vuelta del for.
      }
    }

    throw new HttpError(409, "No se pudo registrar el prospecto tras varios intentos concurrentes; reintenta");
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

    // Transacción agregada (hallazgo de code review, 14-sep-2026): eran
    // dos escrituras sueltas -- si el UPDATE de prospectos committaba y el
    // INSERT de auditoría tronaba después, el prospecto cambiaba de
    // estado sin ningún rastro en auditoria, y no hay ningún mecanismo de
    // reintento que lo repare (a diferencia de registrarRespuesta/
    // clasificarRespuesta, que sí son idempotentes por execution_id).
    await this.db.transaction(async (tx) => {
      await tx.update(prospectos).set({ estado }).where(eq(prospectos.id, input.prospecto_id));
      await tx.insert(auditoria).values({
        usuarioId: null,
        entidad: "prospecto",
        entidadId: input.prospecto_id,
        accion: "validar_automatizacion",
        despues: { execution_id: input.execution_id, valido, motivos, estado }
      });
    });

    return { id: input.prospecto_id, valido, motivos, estado };
  }

  // --- Estado de prospecto -------------------------------------------------------
  async actualizarEstadoProspecto(input: EstadoProspectoInput) {
    const [prospecto] = await this.db.select({ id: prospectos.id, estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    // Transacción agregada (hallazgo de code review, 14-sep-2026), mismo
    // motivo que validarProspecto() arriba.
    await this.db.transaction(async (tx) => {
      await tx.update(prospectos).set({ estado: input.estado }).where(eq(prospectos.id, input.prospecto_id));
      await tx.insert(auditoria).values({
        usuarioId: null,
        entidad: "prospecto",
        entidadId: input.prospecto_id,
        accion: "cambiar_estado_automatizacion",
        antes: { estado: prospecto.estado },
        despues: { execution_id: input.execution_id, estado: input.estado, motivo: input.motivo }
      });
    });

    return { id: input.prospecto_id, estado: input.estado, motivo: input.motivo };
  }

  // Compartido por verificarEnvio() y registrarEnvio(): true si el medio
  // de contacto (correo/whatsapp) de este prospecto para este canal está
  // en lista_supresion. No asume que el medio ya esté marcado
  // estado_contacto='no_contactar' -- registrarSupresion() solo actualiza
  // esa columna si el medio YA existía en el momento de suprimirse; si el
  // medio se agrega/reactiva después con el mismo valor, mediosContacto
  // vuelve a nacer en 'activo' (default de columna) aunque lista_supresion
  // siga teniendo el registro, así que esta consulta va directo contra
  // lista_supresion, la fuente de verdad real (hallazgo de code review,
  // 14-sep-2026).
  private async estaSuprimido(prospectoId: number, canal: "correo" | "whatsapp"): Promise<boolean> {
    const [medio] = await this.db
      .select({ valorNormalizado: mediosContacto.valorNormalizado })
      .from(mediosContacto)
      .innerJoin(prospectos, eq(prospectos.contactoId, mediosContacto.contactoId))
      .where(and(eq(prospectos.id, prospectoId), eq(mediosContacto.tipo, canal)))
      .limit(1);
    if (!medio) return false;

    const [suprimido] = await this.db
      .select({ id: listaSupresion.id })
      .from(listaSupresion)
      .where(and(eq(listaSupresion.tipo, canal), eq(listaSupresion.valorNormalizado, medio.valorNormalizado)))
      .limit(1);
    return !!suprimido;
  }

  // Compartido por verificarEnvio(), registrarEnvio() y
  // listarVentanasVencidas(): envíos del ciclo actual de la PERSONA en este
  // canal, sumando todos sus prospectos, del más reciente al más antiguo.
  // Antes se contaba por prospecto_id, así que un reingreso de la misma
  // persona (prospecto nuevo, mismo contacto) arrancaba otra vez en 0
  // envíos y sin ventana abierta (hallazgo de la auditoría del workflow
  // "PT1. ingesta y scoring", 22-sep-2026). El ciclo se corta en el primer
  // hueco de MESES_ENFRIAMIENTO o más: si el último envío ya tiene esa
  // antigüedad, el ciclo está vacío y la persona vuelve a empezar.
  private async cicloActualDePersona(db: DrizzleDb | DrizzleTx, contactoId: number, canal: "correo" | "whatsapp") {
    const rows = await db
      .select({ id: envios.id, enviadoEn: envios.enviadoEn, ventanaEstado: envios.ventanaEstado, ventanaVenceEn: envios.ventanaVenceEn })
      .from(envios)
      .innerJoin(prospectos, eq(prospectos.id, envios.prospectoId))
      .where(and(eq(prospectos.contactoId, contactoId), eq(envios.canal, canal)))
      .orderBy(desc(envios.enviadoEn), desc(envios.id));

    const ciclo: typeof rows = [];
    let referencia = new Date();
    for (const row of rows) {
      if (sumarMeses(row.enviadoEn, MESES_ENFRIAMIENTO) <= referencia) break;
      ciclo.push(row);
      referencia = row.enviadoEn;
    }
    return ciclo;
  }

  // --- Verificación de envío ----------------------------------------------------------
  // B1, paso 9 (PLAN_N8N_DEFINITIVO.md): gate antes de enviar. Bloquea por
  // canal apagado (política de contactos: WhatsApp sigue desactivado hasta
  // tener proveedor aprobado), por máximo de 3 contactos totales (envío
  // inicial + dos recordatorios), o por una ventana de espera del último
  // envío que sigue abierta y vigente.
  async verificarEnvio(query: VerificacionEnvioQuery) {
    if (query.canal === "whatsapp") {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "Canal WhatsApp desactivado (pendiente proveedor aprobado)", numero_en_ciclo_siguiente: null, ventana_vence_en: null };
    }

    // Join contra contactos/empresas para exigir que ambos sigan activos
    // (hallazgo de code review, 14-sep-2026): antes, un prospecto ya
    // validado (estado='validado', validado cuando su contacto/empresa SÍ
    // estaban activos) seguía pasando este gate indefinidamente aunque su
    // empresa se desactivara después -- la automatización podía seguir
    // enviándole correos a una empresa ya dada de baja en el CRM.
    const [prospecto] = await this.db
      .select({ id: prospectos.id, contactoId: prospectos.contactoId, contactoActivo: contactos.activo, empresaActiva: empresas.activo })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(eq(prospectos.id, query.prospecto_id))
      .limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    if (!prospecto.contactoActivo || !prospecto.empresaActiva) {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "El contacto o la empresa fueron desactivados", numero_en_ciclo_siguiente: null, ventana_vence_en: null };
    }

    // Consulta directa a lista_supresion agregada (hallazgo de code
    // review, 14-sep-2026): antes este gate confiaba por completo en que
    // n8n hubiera llamado ANTES a "Consulta de supresión" como paso
    // separado del flujo (PLAN_N8N_DEFINITIVO.md B1) -- si el workflow
    // reintenta/reentra directo en verificación sin repetir ese paso
    // (bug de workflow, reintento manual, etc.), este endpoint dejaba
    // pasar el envío sin ninguna comprobación de supresión propia. Mismo
    // chequeo en registrarEnvio() más abajo.
    if (await this.estaSuprimido(query.prospecto_id, query.canal)) {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "El contacto está en la lista de supresión", numero_en_ciclo_siguiente: null, ventana_vence_en: null };
    }

    const ciclo = await this.cicloActualDePersona(this.db, prospecto.contactoId, query.canal);
    const ultimo = ciclo[0];
    const total = ciclo.length;

    if (total >= MAX_CONTACTOS_POR_CICLO) {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "Máximo de 3 contactos alcanzado", numero_en_ciclo_siguiente: null, ventana_vence_en: null };
    }

    if (ultimo && ultimo.ventanaEstado === "abierta" && ultimo.ventanaVenceEn > new Date()) {
      return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: false, motivo: "Ventana de espera activa", numero_en_ciclo_siguiente: total + 1, ventana_vence_en: ultimo.ventanaVenceEn };
    }

    return { prospecto_id: query.prospecto_id, canal: query.canal, puede_enviar: true, motivo: null, numero_en_ciclo_siguiente: total + 1, ventana_vence_en: null };
  }

  // --- Registro de envío --------------------------------------------------------------
  // B1, paso 12. Abre una nueva ventana de espera de 5 días hábiles
  // (B0, punto 3: "crear ventanas de espera al registrar envíos").
  // numero_contacto se recalcula en el servidor en vez de confiar en lo
  // que mande n8n, para no desincronizarse de Verificación de envío si
  // algo se salta el orden del flujo. Ojo: numero_contacto sigue siendo el
  // consecutivo DENTRO del prospecto (lo exige el UNIQUE de migración 011);
  // el número que cuenta para la política es numero_en_ciclo, por persona.
  // Aquí se repiten el límite y la ventana de espera de verificarEnvio()
  // porque los recordatorios (Ventanas vencidas) llegan directo a este
  // endpoint sin pasar por la verificación.
  async registrarEnvio(input: RegistroEnvioInput) {
    const [existing] = await this.db
      .select({ id: envios.id, numeroContacto: envios.numeroContacto, ventanaVenceEn: envios.ventanaVenceEn })
      .from(envios)
      .where(eq(envios.executionId, input.execution_id))
      .limit(1);
    // numero_en_ciclo: null en los reintentos idempotentes -- recalcularlo
    // después del hecho no es confiable (el ciclo pudo avanzar desde entonces).
    if (existing) return { id: existing.id, numero_contacto: existing.numeroContacto, numero_en_ciclo: null, ventana_vence_en: existing.ventanaVenceEn, ya_existia: true as const };

    if (input.canal === "whatsapp") {
      throw new HttpError(409, "Canal WhatsApp desactivado (pendiente proveedor aprobado)");
    }

    const [prospecto] = await this.db.select({ id: prospectos.id, contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    const ventanaVenceEn = addBusinessDays(new Date(), 5);

    // Reintento acotado: envios tiene UNIQUE(prospecto_id, canal,
    // numero_contacto) (migración 011), así que si otra llamada
    // concurrente (execution_id distinto) toma el mismo número de
    // contacto entre este SELECT y el INSERT, el insert falla por
    // duplicado en vez de crear dos filas con el mismo numero_contacto —
    // se recalcula el total y se reintenta, en vez de confiar solo en el
    // chequeo en memoria (hallazgo de code review, 10-sep-2026).
    //
    // El chequeo de supresión vive DENTRO de esta misma transacción, con
    // un FOR UPDATE sobre la fila de medios_contacto (hallazgo de code
    // review, 14-sep-2026): hacerlo antes y fuera de una transacción (como
    // en un primer intento de este fix) dejaba una ventana real entre "leer
    // que no está suprimido" y "confirmar el envío" en la que un
    // registrarSupresion() concurrente para ese mismo valor podía colarse
    // sin que este método se enterara. Con el FOR UPDATE, un
    // registrarSupresion() concurrente que intente actualizar esa misma
    // fila de medios_contacto se queda esperando a que esta transacción
    // termine -- el orden final ya no es ambiguo, sea cual sea quien
    // arrancó primero.
    const MAX_INTENTOS = 3;
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      try {
        return await this.db.transaction(async (tx) => {
          const [medio] = await tx
            .select({ valorNormalizado: mediosContacto.valorNormalizado })
            .from(mediosContacto)
            .innerJoin(prospectos, eq(prospectos.contactoId, mediosContacto.contactoId))
            .where(and(eq(prospectos.id, input.prospecto_id), eq(mediosContacto.tipo, input.canal)))
            .limit(1)
            .for("update");
          if (medio) {
            const [suprimido] = await tx
              .select({ id: listaSupresion.id })
              .from(listaSupresion)
              .where(and(eq(listaSupresion.tipo, input.canal), eq(listaSupresion.valorNormalizado, medio.valorNormalizado)))
              .limit(1);
            if (suprimido) throw new HttpError(409, "El contacto está en la lista de supresión");
          }

          // Va DESPUÉS del FOR UPDATE de arriba a propósito: todos los
          // prospectos de la misma persona bloquean la misma fila de
          // medios_contacto, así que dos envíos concurrentes para la misma
          // persona (desde prospectos distintos, donde el UNIQUE de
          // numero_contacto no los detecta) se serializan aquí.
          const ciclo = await this.cicloActualDePersona(tx, prospecto.contactoId, input.canal);
          if (ciclo.length >= MAX_CONTACTOS_POR_CICLO) throw new HttpError(409, "Máximo de 3 contactos alcanzado para esta persona y canal");
          const ultimoDePersona = ciclo[0];
          if (ultimoDePersona && ultimoDePersona.ventanaEstado === "abierta" && ultimoDePersona.ventanaVenceEn > new Date()) {
            throw new HttpError(409, "Ventana de espera activa para esta persona y canal");
          }

          const [ultimo] = await tx
            .select({ numeroContacto: envios.numeroContacto })
            .from(envios)
            .where(and(eq(envios.prospectoId, input.prospecto_id), eq(envios.canal, input.canal)))
            .orderBy(desc(envios.numeroContacto))
            .limit(1);

          const numeroContacto = (ultimo?.numeroContacto ?? 0) + 1;

          const [result] = await tx.insert(envios).values({
            prospectoId: input.prospecto_id,
            canal: input.canal,
            numeroContacto,
            ventanaVenceEn,
            executionId: input.execution_id
          });
          return { id: result.insertId, numero_contacto: numeroContacto, numero_en_ciclo: ciclo.length + 1, ventana_vence_en: ventanaVenceEn, ya_existia: false as const };
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (!isDuplicateEntry(error)) throw error;

        const [retry] = await this.db
          .select({ id: envios.id, numeroContacto: envios.numeroContacto, ventanaVenceEn: envios.ventanaVenceEn })
          .from(envios)
          .where(eq(envios.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, numero_contacto: retry.numeroContacto, numero_en_ciclo: null, ventana_vence_en: retry.ventanaVenceEn, ya_existia: true as const };

        // No fue nuestro propio execution_id el que chocó -- fue el
        // UNIQUE de numero_contacto contra otra llamada concurrente.
        // Se recalcula el total en la siguiente vuelta del for.
      }
    }

    throw new HttpError(409, "No se pudo registrar el envío tras varios intentos concurrentes; reintenta");
  }

  // --- Ventanas vencidas ---------------------------------------------------------------
  // B2 (PLAN_API_DEFINITIVO.md #15): n8n hace polling de esto (política de
  // contactos: 5 días hábiles de espera) para decidir el siguiente paso de
  // cada prospecto en espera. Semántica de "reclamar": las filas devueltas
  // se marcan vencida en la misma transacción, para que un segundo poll
  // concurrente (o el siguiente ciclo) no las vuelva a traer. Si n8n falla
  // después de reclamarlas, el Error Workflow (B4) es la red de
  // recuperación, no un reintento automático de este endpoint.
  // es_ultimo_contacto=true (la PERSONA ya llegó a 3 contactos en su ciclo
  // actual) le dice a n8n que debe marcar inactividad (Estado de
  // prospecto) en vez de mandar otro recordatorio. Si la persona tiene un
  // envío más reciente desde otro prospecto (reingreso), la fila vieja se
  // reclama igual pero no se devuelve: el seguimiento continúa desde la
  // ventana del envío más reciente, no desde esta.
  async listarVentanasVencidas(query: VentanasVencidasQuery) {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: envios.id,
          prospectoId: envios.prospectoId,
          canal: envios.canal,
          numeroContacto: envios.numeroContacto,
          enviadoEn: envios.enviadoEn
        })
        .from(envios)
        .where(and(eq(envios.ventanaEstado, "abierta"), lte(envios.ventanaVenceEn, sql`CURRENT_TIMESTAMP`)))
        .orderBy(envios.ventanaVenceEn)
        .limit(query.limit)
        // SELECT ... FOR UPDATE SKIP LOCKED: sin esto, dos polls
        // concurrentes de n8n podían leer las mismas filas "abierta" antes
        // de que cualquiera confirmara el UPDATE a "vencida" y reclamar el
        // mismo envío dos veces (hallazgo de code review, 10-sep-2026).
        // skipLocked en vez de bloquear: el segundo poll simplemente se
        // queda con las filas que el primero no tomó, no espera a que
        // termine su transacción.
        .for("update", { skipLocked: true });

      if (rows.length === 0) return { data: [] };

      await tx.update(envios).set({ ventanaEstado: "vencida" }).where(inArray(envios.id, rows.map((row) => row.id)));

      // contacto_id en una consulta aparte, no con un JOIN en el SELECT de
      // arriba: con FOR UPDATE SKIP LOCKED, el JOIN también bloquearía las
      // filas de prospectos y se saltaría envíos solo porque otra
      // transacción está tocando su prospecto.
      const duenos = await tx
        .select({ id: prospectos.id, contactoId: prospectos.contactoId })
        .from(prospectos)
        .where(inArray(prospectos.id, [...new Set(rows.map((row) => row.prospectoId))]));
      const contactoDe = new Map(duenos.map((d) => [d.id, d.contactoId]));

      const data = [];
      for (const row of rows) {
        const ciclo = await this.cicloActualDePersona(tx, contactoDe.get(row.prospectoId)!, row.canal);
        if (ciclo[0]?.id !== row.id) continue;
        data.push({
          envio_id: row.id,
          prospecto_id: row.prospectoId,
          canal: row.canal,
          numero_contacto: row.numeroContacto,
          numero_en_ciclo: ciclo.length,
          es_ultimo_contacto: ciclo.length >= MAX_CONTACTOS_POR_CICLO,
          enviado_en: row.enviadoEn
        });
      }

      return { data };
    });
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
    // La comparación de "hoy" se hace con CURDATE() del propio MySQL, no
    // con new Date() en Node: comparar contra una fecha calculada en JS
    // (típicamente UTC) contra fecha_fin (DATE simple, sin hora) desalinea
    // el resultado varias horas alrededor de medianoche según la zona
    // horaria del servidor de la API.
    const [row] = await this.db
      .select({
        nombre: campanas.nombre,
        estado: campanas.estado,
        vigente: sql<number>`(${campanas.fechaFin} IS NULL OR ${campanas.fechaFin} >= CURDATE())`
      })
      .from(campanas)
      .where(eq(campanas.id, query.campana_id))
      .limit(1);
    if (!row) throw new HttpError(404, "Campaña no encontrada");

    const activa = row.estado === "activa" && !!row.vigente;

    return { campana_id: query.campana_id, nombre: row.nombre, estado: row.estado, activa };
  }

  // --- Consulta de supresión -------------------------------------------------------
  // B1, paso 8: "verificar antes de enviar" (PLAN_API_DEFINITIVO.md).
  async consultarSupresion(query: ConsultaSupresionQuery) {
    const valorNormalizado = normalizarValorSupresion(query.tipo, query.valor);
    const [row] = await this.db
      .select({ motivo: listaSupresion.motivo })
      .from(listaSupresion)
      .where(and(eq(listaSupresion.tipo, query.tipo), eq(listaSupresion.valorNormalizado, valorNormalizado)))
      .limit(1);

    return { en_supresion: !!row, motivo: row?.motivo ?? null };
  }

  // --- Registro de supresión ---------------------------------------------------------
  // Endpoint para cuando n8n necesite suprimir un medio por su cuenta (p.
  // ej. el link de baja de SendGrid, PLAN_N8N_DEFINITIVO.md B2). La lógica
  // vive en shared/supresion.ts para que las clasificaciones "baja" (la de
  // n8n y la manual del CRM) la usen dentro de su propia transacción.
  //
  // Las 3 escrituras (lista_supresion, medios_contacto, auditoría) corren en
  // una sola transacción (hallazgo de code review, 14-sep-2026): si el
  // UPDATE de medios_contacto tronaba después de confirmar el insert, un
  // retry de n8n devolvía ya_existia sin volver a intentar ese UPDATE.
  async registrarSupresion(input: RegistroSupresionInput) {
    return this.db.transaction((tx) => registrarSupresion(tx, {
      tipo: input.tipo,
      valorNormalizado: normalizarValorSupresion(input.tipo, input.valor),
      motivo: input.motivo,
      executionId: input.execution_id,
      usuarioId: null
    }));
  }

  // --- Respuesta recibida ---------------------------------------------------------------
  // B2 (PLAN_API_DEFINITIVO.md #16): n8n llama esto en cuanto llega una
  // respuesta del proveedor de correo/WhatsApp. Cierra la ventana de
  // espera abierta del último envío (para que "Ventanas vencidas" deje de
  // programar recordatorios) o, si no hay ventana abierta para ese
  // prospecto+canal, la marca como tardía y crea una tarea comercial en
  // vez de tocar el outbound (PLAN_N8N_DEFINITIVO.md: "procesar
  // respuestas tardías: crear tarea comercial, no reiniciar
  // automáticamente el outbound").
  async registrarRespuesta(input: RespuestaRecibidaInput) {
    const [existing] = await this.db
      .select({ id: respuestas.id, envioId: respuestas.envioId, tardia: respuestas.tardia })
      .from(respuestas)
      .where(eq(respuestas.executionId, input.execution_id))
      .limit(1);
    if (existing) return { id: existing.id, envio_id: existing.envioId, tardia: existing.tardia, ya_existia: true as const };

    const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    const [ultimo] = await this.db
      .select({ id: envios.id, ventanaEstado: envios.ventanaEstado })
      .from(envios)
      .where(and(eq(envios.prospectoId, input.prospecto_id), eq(envios.canal, input.canal)))
      .orderBy(desc(envios.numeroContacto))
      .limit(1);

    const ventanaAbierta = ultimo?.ventanaEstado === "abierta";
    const tardia = !ventanaAbierta;
    const envioId = ultimo?.id ?? null;

    // Insert de respuestas + cierre de ventana + creación de la tarea
    // comercial van en una sola transacción: antes eran escrituras
    // sueltas, así que si createFromAutomation fallaba después de que ya
    // se hubiera confirmado la respuesta (tardia=true), el retry
    // idempotente entraba por el early-return de arriba y nunca reintentaba
    // crear la tarea perdida (hallazgo de code review, 10-sep-2026).
    try {
      return await this.db.transaction(async (tx) => {
        const [result] = await tx.insert(respuestas).values({
          prospectoId: input.prospecto_id,
          envioId,
          canal: input.canal,
          contenido: input.contenido ?? null,
          tardia,
          executionId: input.execution_id
        });

        if (ventanaAbierta && ultimo) {
          await tx.update(envios).set({ ventanaEstado: "cerrada" }).where(eq(envios.id, ultimo.id));
        }

        let tareaId: number | null = null;
        if (tardia) {
          const tarea = await this.tareasService.createFromAutomation({
            execution_id: `resp-tardia-${input.execution_id}`,
            prospecto_id: input.prospecto_id,
            tipo: "seguimiento",
            titulo: "Respuesta tardía de prospecto",
            descripcion: input.contenido,
            prioridad: "media"
          }, tx);
          tareaId = tarea.id;
        }

        return { id: result.insertId, envio_id: envioId, tardia, tarea_id: tareaId, ya_existia: false as const };
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [retry] = await this.db
          .select({ id: respuestas.id, envioId: respuestas.envioId, tardia: respuestas.tardia })
          .from(respuestas)
          .where(eq(respuestas.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, envio_id: retry.envioId, tardia: retry.tardia, ya_existia: true as const };
      }
      throw error;
    }
  }

  // --- Respuesta clasificada -------------------------------------------------------------
  // B2 (PLAN_API_DEFINITIVO.md #17): recibe el veredicto (IA o el criterio
  // que use n8n) y decide qué pasa con el prospecto. El caso "ambigua" no
  // fija un estado final: crea una tarea tipo=clasificacion que cae en la
  // bandeja `/cola-clasificacion` para que el Equipo CRM decida
  // manualmente (PLAN_N8N_DEFINITIVO.md B2). El resto fija el estado del
  // prospecto (mapa compartido con la clasificación manual), y "baja"
  // además registra la supresión en esta misma transacción. Antes eso lo
  // hacía n8n como paso aparte: una obligación legal que dependía de un
  // segundo llamado que podía olvidarse o fallar solo (24-sep-2026).
  async clasificarRespuesta(input: RespuestaClasificadaInput) {
    const [respuesta] = await this.db
      .select({
        id: respuestas.id,
        prospectoId: respuestas.prospectoId,
        canal: respuestas.canal,
        contenido: respuestas.contenido,
        estado: respuestas.estado,
        clasificacion: respuestas.clasificacion,
        executionIdClasificacion: respuestas.executionIdClasificacion
      })
      .from(respuestas)
      .where(eq(respuestas.id, input.respuesta_id))
      .limit(1);
    if (!respuesta) throw new HttpError(404, "Respuesta no encontrada");

    if (respuesta.estado === "clasificada") {
      if (respuesta.executionIdClasificacion === input.execution_id) {
        return { id: respuesta.id, prospecto_id: respuesta.prospectoId, clasificacion: respuesta.clasificacion, tarea_id: null, ya_existia: true as const };
      }
      throw new HttpError(409, "La respuesta ya fue clasificada");
    }

    const nuevoEstado = ESTADO_PROSPECTO_POR_CLASIFICACION[input.clasificacion];

    // Update de respuestas + update de prospectos + creación de la tarea
    // "ambigua" + auditoría van en una sola transacción: antes eran
    // escrituras sueltas, así que si createFromAutomation fallaba después
    // de confirmar respuestas.estado='clasificada', el retry idempotente
    // entraba por el early-return de arriba (estado ya es 'clasificada') y
    // nunca reintentaba crear la tarea perdida (hallazgo de code review,
    // 10-sep-2026).
    return this.db.transaction(async (tx) => {
      try {
        // ne(estado, "clasificada") + affectedRows (hallazgo de code
        // review, 14-sep-2026): el guard de arriba (estado==='clasificada')
        // se lee ANTES de esta transacción -- sin revalidarlo aquí dentro,
        // dos POST /respuestas/clasificacion concurrentes para la misma
        // respuesta (distinto execution_id cada uno) pasaban ambos ese
        // guard, y el segundo en confirmar pisaba en silencio la
        // clasificación del primero (y el estado del prospecto), con dos
        // filas de auditoría contradictorias. Mismo patrón CAS que ya usa
        // TareasService.cerrar()/clasificar().
        const [result] = await tx.update(respuestas).set({
          estado: "clasificada",
          clasificacion: input.clasificacion,
          comentario: input.comentario ?? null,
          executionIdClasificacion: input.execution_id,
          clasificadoEn: sql`CURRENT_TIMESTAMP`
        }).where(and(eq(respuestas.id, input.respuesta_id), ne(respuestas.estado, "clasificada")));
        if (result.affectedRows === 0) {
          throw new HttpError(409, "La respuesta ya fue clasificada por otra solicitud");
        }
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new HttpError(409, "execution_id de clasificación ya usado en otra respuesta");
        }
        throw error;
      }

      if (nuevoEstado) {
        await tx.update(prospectos).set({ estado: nuevoEstado }).where(eq(prospectos.id, respuesta.prospectoId));
      }

      const supresionIds = input.clasificacion === "baja"
        ? await suprimirMediosDelProspecto(tx, { prospectoId: respuesta.prospectoId, canal: respuesta.canal, motivo: `Baja pedida en respuesta ${respuesta.id} (clasificación de n8n)`, executionId: input.execution_id, usuarioId: null })
        : [];

      let tareaId: number | null = null;
      if (input.clasificacion === "ambigua") {
        const tarea = await this.tareasService.createFromAutomation({
          execution_id: `resp-clasif-${input.execution_id}`,
          prospecto_id: respuesta.prospectoId,
          respuesta_id: respuesta.id,
          tipo: "clasificacion",
          titulo: "Clasificar respuesta ambigua",
          descripcion: input.comentario ?? respuesta.contenido ?? undefined,
          prioridad: "media"
        }, tx);
        tareaId = tarea.id;
      }

      await tx.insert(auditoria).values({
        usuarioId: null,
        entidad: "respuesta",
        entidadId: input.respuesta_id,
        accion: "clasificar_respuesta",
        despues: { execution_id: input.execution_id, clasificacion: input.clasificacion, tarea_id: tareaId, supresion_ids: supresionIds }
      });

      return { id: respuesta.id, prospecto_id: respuesta.prospectoId, clasificacion: input.clasificacion, tarea_id: tareaId, ya_existia: false as const };
    });
  }
}
