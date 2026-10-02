import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { and, desc, eq, inArray, isNotNull, lte, ne, notInArray, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, campanas, contactos, empresas, envios, incidencias, listaSupresion, mediosContacto, parametrosAutomatizacion, procesosFallidos, prospectos, respuestas, resultadosScoring } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import { isDuplicateEntry } from "../shared/database-errors.js";
import { insertarMediosContacto } from "../shared/medios-contacto.js";
import { normalizarValorSupresion, registrarSupresion, suprimirMediosDeContacto } from "../shared/supresion.js";
import { darDeBajaPersona, personaEnBaja } from "../shared/baja-prospecto.js";
import { buscarPersona } from "../shared/identidad.js";
import { campanaEnEsperaSql, campanaNoHaTerminadoSql, campanaYaEmpezoSql, vigenciaCampana } from "../shared/campana-vigente.js";
import { fechaMx } from "../shared/dia-habil.js";
import { obtenerCatalogosEnum } from "../shared/catalogos-enum.js";
import { firmarReplyTo, leerReplyTo } from "../shared/reply-to.js";
import { CODIGO_RESPUESTA_YA_CLASIFICADA } from "../shared/clasificaciones.js";
import { TareasService } from "../tareas/tareas.service.js";
import { EVENTOS_BAJA_DE_PERSONA } from "./dto/automatizacion.schema.js";
import type { CampanaActivaQuery, ConsultaProspectoScoringQuery, ConsultaSupresionQuery, ErrorWorkflowInput, EstadoProspectoInput, IncidenciaInput, RegistroEnvioInput, RegistroProspectoInput, RegistroSupresionInput, RespuestaClasificadaInput, RespuestaRecibidaInput, RespuestaSugeridaInput, ScoringInput, ValidacionInput, VentanasVencidasQuery, VerificacionEnvioQuery } from "./dto/automatizacion.schema.js";

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

// Estados en los que un prospecto ya no recibe recordatorios: respondió y
// se clasificó, pidió la baja, o la automatización lo sacó del flujo.
const ESTADOS_PROSPECTO_CERRADO: readonly string[] = ["baja", "interesado", "no_interesado", "descartado", "excluido", "inactivo"];

// Por qué /envios/vencidas no devuelve una ventana (ver destinoDeRecordatorio).
type MotivoRecordatorioOmitido = "prospecto_cerrado" | "campana_inactiva" | "sin_correo" | "suprimido" | "canal_desactivado";

// Lo que n8n necesita para mandar un recordatorio. Nada de esto va a
// Gemini (PLAN_N8N_DEFINITIVO.md B2, flujo de recordatorios).
type CorreoDeRecordatorio = { valor: string } | { motivo: "sin_correo" | "suprimido" | "canal_desactivado" };

type DatosRecordatorio = {
  correo: string | null;
  contacto_nombre: string;
  empresa_nombre: string;
  giro: string | null;
  campana_id: number | null;
  campana_activa: boolean | null;
};

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
  // Deduplica personas con buscarPersona (shared/identidad.ts, "el correo
  // manda", 2-oct-2026): con correo, solo por correo; sin correo, por
  // teléfono — nunca por razón social de la empresa (regla explícita de
  // PLAN_CRM_DEFINITIVO.md). Idempotente por execution_id.
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
          // ¿Quién es? "El correo manda" (shared/identidad.ts, 2-oct-2026):
          // con correo solo identifica el correo; sin correo, el teléfono.
          // Sin importar si el contacto está activo: el UNIQUE(tipo,
          // valor_normalizado) de medios_contacto es global, así que reusar
          // evita chocar con esa restricción al insertar el mismo valor.
          const identidad = await buscarPersona(tx, { correoNormalizado, telefonoNormalizado });

          let contactoId: number;
          let empresaId: number;
          const duplicado = identidad.tipo === "misma_persona";
          // Persona nueva que comparte teléfono (conmutador) con alguien ya
          // registrado: va a la empresa de esa persona, no a una empresa nueva.
          const empresaReutilizada = identidad.tipo === "nueva" && identidad.empresaDelTelefono !== null;

          if (identidad.tipo === "misma_persona") {
            contactoId = identidad.contactoId;
            empresaId = identidad.empresaId;
          } else if (identidad.empresaDelTelefono !== null) {
            empresaId = identidad.empresaDelTelefono;
            const [contact] = await tx.insert(contactos).values({
              empresaId,
              nombre: input.contacto.nombre,
              puesto: input.contacto.puesto ?? null,
              area: input.contacto.area ?? null
            });
            contactoId = contact.insertId;
            // El teléfono ya es de otra persona: solo se guarda el correo.
            await insertarMediosContacto(tx, contactoId, [{ tipo: "correo", valor: input.contacto.correo, valorNormalizado: correoNormalizado }]);
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

          // Una persona que ya pidió la baja no vuelve a entrar al flujo: su
          // prospecto nuevo nace en baja (A2, 2-oct-2026).
          const enBaja = duplicado && await personaEnBaja(tx, contactoId);
          const [prospecto] = await tx.insert(prospectos).values({
            contactoId,
            campanaId: input.campana_id ?? null,
            executionId: input.execution_id,
            estado: enBaja ? "baja" : "capturado",
            fuenteUrl: input.fuente_url ?? null,
            confianza: input.confianza ?? null
          });

          await tx.insert(auditoria).values({
            usuarioId: null,
            entidad: "prospecto",
            entidadId: prospecto.insertId,
            accion: "registrar_automatizacion",
            despues: { execution_id: input.execution_id, contacto_id: contactoId, empresa_id: empresaId, duplicado, empresa_reutilizada: empresaReutilizada, nace_en_baja: enBaja }
          });

          return { id: prospecto.insertId, contacto_id: contactoId, empresa_id: empresaId, duplicado, empresa_reutilizada: empresaReutilizada, ya_existia: false as const };
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
    //
    // La baja no se deshace (A3, 2-oct-2026): un prospecto en baja no pasa a
    // validado/excluido. Se responde no válido con el motivo
    // prospecto_en_baja, así PT1 toma su rama de exclusión de siempre.
    const cambio = await this.db.transaction(async (tx) => {
      const [result] = await tx.update(prospectos).set({ estado }).where(and(eq(prospectos.id, input.prospecto_id), ne(prospectos.estado, "baja")));
      if (result.affectedRows === 0) return false;
      await tx.insert(auditoria).values({
        usuarioId: null,
        entidad: "prospecto",
        entidadId: input.prospecto_id,
        accion: "validar_automatizacion",
        despues: { execution_id: input.execution_id, valido, motivos, estado }
      });
      return true;
    });

    if (!cambio) return { id: input.prospecto_id, valido: false, motivos: ["prospecto_en_baja"], estado: "baja", en_baja: true as const };
    return { id: input.prospecto_id, valido, motivos, estado, en_baja: false as const };
  }

  // --- Estado de prospecto -------------------------------------------------------
  async actualizarEstadoProspecto(input: EstadoProspectoInput) {
    const [prospecto] = await this.db.select({ id: prospectos.id, estado: prospectos.estado }).from(prospectos).where(eq(prospectos.id, input.prospecto_id)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    // Transacción agregada (hallazgo de code review, 14-sep-2026), mismo
    // motivo que validarProspecto() arriba.
    //
    // La baja no se deshace (A3 del plan de fixes, 2-oct-2026): el UPDATE
    // no toca a un prospecto en baja. Antes PT4 marcaba "inactivo" a alguien
    // que acababa de darse de baja, y con eso salía de baja. No es error:
    // responde lo que hay, con en_baja, para que n8n siga sin caer al
    // Error Workflow.
    const cambio = await this.db.transaction(async (tx) => {
      const [result] = await tx.update(prospectos).set({ estado: input.estado }).where(and(eq(prospectos.id, input.prospecto_id), ne(prospectos.estado, "baja")));
      if (result.affectedRows === 0) return false;
      await tx.insert(auditoria).values({
        usuarioId: null,
        entidad: "prospecto",
        entidadId: input.prospecto_id,
        accion: "cambiar_estado_automatizacion",
        antes: { estado: prospecto.estado },
        despues: { execution_id: input.execution_id, estado: input.estado, motivo: input.motivo }
      });
      return true;
    });

    if (!cambio) return { id: input.prospecto_id, estado: "baja", motivo: input.motivo, en_baja: true as const };
    return { id: input.prospecto_id, estado: input.estado, motivo: input.motivo, en_baja: false as const };
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
    if (existing) return { id: existing.id, numero_contacto: existing.numeroContacto, numero_en_ciclo: null, ventana_vence_en: existing.ventanaVenceEn, reply_to: firmarReplyTo(existing.id), ya_existia: true as const };

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
          return { id: result.insertId, numero_contacto: numeroContacto, numero_en_ciclo: ciclo.length + 1, ventana_vence_en: ventanaVenceEn, reply_to: firmarReplyTo(result.insertId), ya_existia: false as const };
        });
      } catch (error) {
        if (error instanceof HttpError) throw error;
        if (!isDuplicateEntry(error)) throw error;

        const [retry] = await this.db
          .select({ id: envios.id, numeroContacto: envios.numeroContacto, ventanaVenceEn: envios.ventanaVenceEn })
          .from(envios)
          .where(eq(envios.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, numero_contacto: retry.numeroContacto, numero_en_ciclo: null, ventana_vence_en: retry.ventanaVenceEn, reply_to: firmarReplyTo(retry.id), ya_existia: true as const };

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
    // Fecha de México para las reglas de campaña (ver shared/campana-vigente.ts).
    const hoy = fechaMx(new Date());
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
        .where(and(
          eq(envios.ventanaEstado, "abierta"),
          lte(envios.ventanaVenceEn, sql`CURRENT_TIMESTAMP`),
          // Campañas en espera (pausada o sin empezar): sus ventanas no se
          // reclaman, esperan a que la campaña mande (pausa = espera,
          // decisión del 1-oct-2026). Van fuera aquí, en el SELECT, y no
          // después: si no, ocuparían los lugares del LIMIT en cada corrida
          // y les quitarían el turno a las demás. Es subconsulta, no JOIN:
          // en MySQL el FOR UPDATE de afuera no bloquea las filas de una
          // subconsulta, así que no toca prospectos ni campanas (ver el
          // comentario de contacto_id más abajo).
          notInArray(envios.prospectoId, tx.select({ id: prospectos.id }).from(prospectos).innerJoin(campanas, eq(campanas.id, prospectos.campanaId)).where(campanaEnEsperaSql(hoy)))
        ))
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

      if (rows.length === 0) return { data: [], omitidas: [] };

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
      const omitidas: { envio_id: number; prospecto_id: number; motivo: MotivoRecordatorioOmitido }[] = [];
      for (const row of rows) {
        const contactoId = contactoDe.get(row.prospectoId)!;
        const ciclo = await this.cicloActualDePersona(tx, contactoId, row.canal);
        if (ciclo[0]?.id !== row.id) continue;

        const esUltimoContacto = ciclo.length >= MAX_CONTACTOS_POR_CICLO;
        const destino = await this.destinoDeRecordatorio(tx, row.prospectoId, contactoId, row.canal, esUltimoContacto, hoy);
        if ("motivo" in destino) {
          omitidas.push({ envio_id: row.id, prospecto_id: row.prospectoId, motivo: destino.motivo });
          await tx.insert(auditoria).values({
            usuarioId: null,
            entidad: "envio",
            entidadId: row.id,
            accion: "recordatorio_omitido",
            despues: { motivo: destino.motivo, prospecto_id: row.prospectoId }
          });
          continue;
        }

        data.push({
          envio_id: row.id,
          prospecto_id: row.prospectoId,
          canal: row.canal,
          numero_contacto: row.numeroContacto,
          numero_en_ciclo: ciclo.length,
          es_ultimo_contacto: esUltimoContacto,
          enviado_en: row.enviadoEn,
          ...destino
        });
      }

      return { data, omitidas };
    });
  }

  // A quién va el recordatorio de una ventana vencida, o por qué no se le
  // escribe (decisión del 30-sep-2026). Antes /vencidas no traía ni el
  // correo (la consulta de scoring lo excluye a propósito por Gemini) y
  // n8n tenía que ignorar por su cuenta las ventanas de campañas
  // inactivas. Las omitidas ya quedaron reclamadas (vencida) por el poll:
  // no vuelven a salir, así que el recordatorio queda cancelado. Eso aplica
  // a campañas inactivas (finalizada, borrador, fecha_fin pasada). Las de
  // campañas en espera (pausada o sin empezar) ni siquiera llegan aquí:
  // listarVentanasVencidas las deja abiertas en el SELECT y siguen al
  // reactivarse (pausa = espera, decisión del 1-oct-2026).
  //
  // La última ventana de la persona (es_ultimo_contacto) se devuelve
  // aunque no haya correo o la campaña ya no esté activa: ahí n8n no manda
  // nada, marca al prospecto inactivo. Solo se omite si el prospecto ya
  // está cerrado. Si la campaña está en espera, esa ventana también espera.
  private async destinoDeRecordatorio(tx: DrizzleTx, prospectoId: number, contactoId: number, canal: "correo" | "whatsapp", esUltimoContacto: boolean, hoy: string): Promise<{ motivo: MotivoRecordatorioOmitido } | DatosRecordatorio> {
    const [contexto] = await tx
      .select({
        estado: prospectos.estado,
        campanaId: prospectos.campanaId,
        campanaEstado: campanas.estado,
        campanaYaEmpezo: campanaYaEmpezoSql(hoy),
        campanaNoHaTerminado: campanaNoHaTerminadoSql(hoy),
        contactoNombre: contactos.nombre,
        empresaNombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
        giro: empresas.giro
      })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .leftJoin(campanas, eq(campanas.id, prospectos.campanaId))
      .where(eq(prospectos.id, prospectoId))
      .limit(1);

    if (!contexto || ESTADOS_PROSPECTO_CERRADO.includes(contexto.estado)) return { motivo: "prospecto_cerrado" as const };

    // Una campaña en espera no llega aquí (listarVentanasVencidas la filtra
    // en el SELECT); si se pausó justo entre ese SELECT y esta lectura, la
    // ventana ya quedó reclamada y cuenta como inactiva.
    const campanaActiva = contexto.campanaId === null || contexto.campanaEstado === null
      ? null
      : vigenciaCampana(contexto.campanaEstado, contexto.campanaYaEmpezo, contexto.campanaNoHaTerminado).vigencia === "activa";
    const correo: CorreoDeRecordatorio = canal === "correo" ? await this.correoParaRecordatorio(tx, contactoId) : { motivo: "canal_desactivado" };
    const datos = {
      correo: "valor" in correo ? correo.valor : null,
      contacto_nombre: contexto.contactoNombre,
      empresa_nombre: contexto.empresaNombre,
      giro: contexto.giro,
      campana_id: contexto.campanaId,
      campana_activa: campanaActiva
    };
    if (esUltimoContacto) return datos;

    if (campanaActiva === false) return { motivo: "campana_inactiva" as const };
    if ("motivo" in correo) return { motivo: correo.motivo };
    return datos;
  }

  // El correo al que se manda: uno activo y fuera de lista_supresion (el
  // principal primero). "sin_correo" si la persona no tiene ninguno
  // utilizable; "suprimido" si los que tiene están dados de baja.
  private async correoParaRecordatorio(tx: DrizzleTx, contactoId: number): Promise<CorreoDeRecordatorio> {
    const medios = await tx
      .select({ valor: mediosContacto.valor, valorNormalizado: mediosContacto.valorNormalizado, estado: mediosContacto.estadoContacto })
      .from(mediosContacto)
      .where(and(eq(mediosContacto.contactoId, contactoId), eq(mediosContacto.tipo, "correo"), inArray(mediosContacto.estadoContacto, ["activo", "no_contactar"])))
      .orderBy(desc(mediosContacto.esPrincipal), mediosContacto.id);
    if (medios.length === 0) return { motivo: "sin_correo" as const };

    const suprimidos = await tx
      .select({ valorNormalizado: listaSupresion.valorNormalizado })
      .from(listaSupresion)
      .where(and(eq(listaSupresion.tipo, "correo"), inArray(listaSupresion.valorNormalizado, medios.map((m) => m.valorNormalizado))));
    const enSupresion = new Set(suprimidos.map((s) => s.valorNormalizado));

    const utilizable = medios.find((m) => m.estado === "activo" && !enSupresion.has(m.valorNormalizado));
    return utilizable ? { valor: utilizable.valor } : { motivo: "suprimido" as const };
  }

  // --- Campaña activa ----------------------------------------------------------------
  // B1, paso previo a "Registro de envío" (PLAN_N8N_DEFINITIVO.md): n8n
  // consulta esto justo antes de disparar un envío para no seguir
  // mandando mensajes de una campaña que ya se pausó o finalizó después de
  // que el prospecto entró al flujo. `activa` combina el campo `estado`
  // con las fechas: una campaña puede seguir marcada "activa" en la BD
  // porque nadie la cerró a tiempo, pero si ya pasó su fecha de fin no
  // debe seguir enviando.
  //
  // La regla vive en shared/campana-vigente.ts (compartida con
  // /envios/vencidas y la lista de campañas). Desde el 1-oct-2026 también
  // revisa fecha_inicio y compara contra la fecha de México: antes usaba
  // CURDATE(), que con la conexión en UTC cambia de día a las 6 pm de
  // México. `motivo` dice por qué no manda: con "pausada" o
  // "aun_no_empieza" PT1 debe dejar al prospecto esperando, no cerrarlo.
  async consultarCampanaActiva(query: CampanaActivaQuery) {
    const hoy = fechaMx(new Date());
    const [row] = await this.db
      .select({
        nombre: campanas.nombre,
        estado: campanas.estado,
        yaEmpezo: campanaYaEmpezoSql(hoy),
        noHaTerminado: campanaNoHaTerminadoSql(hoy)
      })
      .from(campanas)
      .where(eq(campanas.id, query.campana_id))
      .limit(1);
    if (!row) throw new HttpError(404, "Campaña no encontrada");

    const { vigencia, motivo } = vigenciaCampana(row.estado, row.yaEmpezo, row.noHaTerminado);

    return { campana_id: query.campana_id, nombre: row.nombre, estado: row.estado, activa: vigencia === "activa", motivo };
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
  // Supresiones que no vienen de una respuesta clasificada: sobre todo los
  // eventos de SendGrid que manda PT3 (PLAN_N8N_DEFINITIVO.md B2). La
  // lógica vive en shared/supresion.ts para que las clasificaciones "baja"
  // (la de n8n y la manual del CRM) la usen dentro de su propia transacción.
  //
  // Alcance según `evento` (decisión del 1-oct-2026):
  // - unsubscribe / group_unsubscribe / spamreport: la persona pidió no ser
  //   contactada, igual que una respuesta clasificada "baja". Se suprimen
  //   TODOS los medios de quien tenga ese valor y sus prospectos pasan a
  //   baja con darDeBajaProspecto (que además cancela sus seguimientos).
  //   Antes solo se suprimía ese correo: el teléfono seguía contactable y
  //   el prospecto seguía como si nada.
  // - bounce, o sin evento: solo ese medio. Un rebote no es una petición de
  //   la persona.
  //
  // Todo corre en una sola transacción (hallazgo de code review,
  // 14-sep-2026): si el UPDATE de medios_contacto tronaba después de
  // confirmar el insert, un retry de n8n devolvía ya_existia sin volver a
  // intentar ese UPDATE.
  async registrarSupresion(input: RegistroSupresionInput) {
    return this.db.transaction(async (tx) => {
      const valorNormalizado = normalizarValorSupresion(input.tipo, input.valor);
      const origen = { motivo: input.motivo, executionId: input.execution_id, usuarioId: null };
      const supresion = await registrarSupresion(tx, { tipo: input.tipo, valorNormalizado, ...origen });

      const esBajaDePersona = input.evento !== undefined && (EVENTOS_BAJA_DE_PERSONA as readonly string[]).includes(input.evento);
      if (!esBajaDePersona) {
        return { ...supresion, alcance: "medio" as const, supresion_ids: [supresion.id], prospectos_en_baja: [] as number[] };
      }

      const duenos = await tx
        .selectDistinct({ contactoId: mediosContacto.contactoId })
        .from(mediosContacto)
        .where(and(eq(mediosContacto.tipo, input.tipo), eq(mediosContacto.valorNormalizado, valorNormalizado), isNotNull(mediosContacto.contactoId)))
        .orderBy(mediosContacto.contactoId);

      const supresionIds = new Set([supresion.id]);
      const prospectosEnBaja: number[] = [];
      for (const { contactoId } of duenos) {
        for (const id of await suprimirMediosDeContacto(tx, contactoId!, origen)) supresionIds.add(id);

        // Misma acción que POST /prospectos/estado: el Historial de la
        // ficha de cliente la muestra como cambio de estado.
        const baja = await darDeBajaPersona(tx, contactoId!, { accion: "cambiar_estado_automatizacion", motivo: input.motivo, executionId: input.execution_id, usuarioId: null });
        prospectosEnBaja.push(...baja.prospectosEnBaja);
      }

      return { ...supresion, alcance: "persona" as const, supresion_ids: [...supresionIds], prospectos_en_baja: prospectosEnBaja };
    });
  }

  // --- Respuesta recibida ---------------------------------------------------------------
  // B2 (PLAN_API_DEFINITIVO.md #16): n8n llama esto en cuanto llega una
  // respuesta del proveedor de correo/WhatsApp. Cierra la ventana de
  // espera abierta del último envío (para que "Ventanas vencidas" deje de
  // programar recordatorios) o, si no hay ventana abierta para ese
  // prospecto+canal, la marca como tardía y crea una tarea comercial en
  // vez de tocar el outbound (PLAN_N8N_DEFINITIVO.md: "procesar
  // respuestas tardías: crear tarea comercial, no reiniciar
  // automáticamente el outbound"). PT2 usa además los modos
  // crear_tarea_clasificacion y automatica (ver respuestaRecibidaInputSchema).
  async registrarRespuesta(input: RespuestaRecibidaInput) {
    const [existing] = await this.db
      .select({ id: respuestas.id, prospectoId: respuestas.prospectoId, envioId: respuestas.envioId, tardia: respuestas.tardia })
      .from(respuestas)
      .where(eq(respuestas.executionId, input.execution_id))
      .limit(1);
    if (existing) return { id: existing.id, identificada: true as const, prospecto_id: existing.prospectoId, envio_id: existing.envioId, tardia: existing.tardia, ya_existia: true as const };

    let prospectoId = input.prospecto_id;
    if (input.reply_to !== undefined) {
      const envioFirmado = leerReplyTo(input.reply_to);
      const [envio] = envioFirmado === null
        ? []
        : await this.db.select({ prospectoId: envios.prospectoId }).from(envios).where(eq(envios.id, envioFirmado)).limit(1);
      if (!envio) return this.registrarRespuestaNoIdentificada(input);
      prospectoId = envio.prospectoId;
    }
    if (prospectoId === undefined) throw new HttpError(400, "Especifica prospecto_id o reply_to");

    const [prospecto] = await this.db.select({ id: prospectos.id }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
    if (!prospecto) throw new HttpError(404, "Prospecto no encontrado");

    const [ultimo] = await this.db
      .select({ id: envios.id, ventanaEstado: envios.ventanaEstado })
      .from(envios)
      .where(and(eq(envios.prospectoId, prospectoId), eq(envios.canal, input.canal)))
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
          prospectoId,
          envioId,
          canal: input.canal,
          contenido: input.contenido ?? null,
          tardia,
          executionId: input.execution_id,
          // Una respuesta automática (fuera de oficina) no es una respuesta
          // de la persona: se guarda ya clasificada como "automatica" (el
          // historial de la ficha la muestra así), sin cerrar la ventana
          // para que los recordatorios sigan, y sin tarea.
          ...(input.automatica ? { estado: "clasificada" as const, clasificacion: "automatica" as const, clasificadoEn: sql`CURRENT_TIMESTAMP` } : {})
        });
        if (input.automatica) {
          return { id: result.insertId, identificada: true as const, prospecto_id: prospectoId, envio_id: envioId, tardia, tarea_id: null, ya_existia: false as const };
        }

        if (ventanaAbierta && ultimo) {
          await tx.update(envios).set({ ventanaEstado: "cerrada" }).where(eq(envios.id, ultimo.id));
        }

        let tareaId: number | null = null;
        if (input.crear_tarea_clasificacion) {
          // Una sola tarea por respuesta, a tiempo o tardía, en esta misma
          // transacción. Su execution_id usa el id de la respuesta y no el
          // de n8n: ese puede medir 100 caracteres, lo mismo que la columna.
          const tarea = await this.tareasService.createFromAutomation({
            execution_id: `resp-recibida-${result.insertId}`,
            prospecto_id: prospectoId,
            respuesta_id: result.insertId,
            tipo: "clasificacion",
            titulo: tardia ? "Clasificar respuesta tardía" : "Clasificar respuesta",
            descripcion: input.contenido,
            prioridad: "media"
          }, tx);
          tareaId = tarea.id;
        } else if (tardia) {
          const tarea = await this.tareasService.createFromAutomation({
            execution_id: `resp-tardia-${input.execution_id}`,
            prospecto_id: prospectoId,
            tipo: "seguimiento",
            titulo: "Respuesta tardía de prospecto",
            descripcion: input.contenido,
            prioridad: "media"
          }, tx);
          tareaId = tarea.id;
        }

        return { id: result.insertId, identificada: true as const, prospecto_id: prospectoId, envio_id: envioId, tardia, tarea_id: tareaId, ya_existia: false as const };
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        const [retry] = await this.db
          .select({ id: respuestas.id, prospectoId: respuestas.prospectoId, envioId: respuestas.envioId, tardia: respuestas.tardia })
          .from(respuestas)
          .where(eq(respuestas.executionId, input.execution_id))
          .limit(1);
        if (retry) return { id: retry.id, identificada: true as const, prospecto_id: retry.prospectoId, envio_id: retry.envioId, tardia: retry.tardia, ya_existia: true as const };
      }
      throw error;
    }
  }

  // Una respuesta a una dirección sin firma válida (alterada, de otro
  // dominio, de un envío que no existe) no se le atribuye a ningún
  // prospecto: no se guarda en respuestas y deja una tarea para que una
  // persona la revise. Las automáticas se descartan. El execution_id de la
  // tarea es un hash del de n8n, que puede medir los mismos 100 caracteres
  // que la columna.
  private async registrarRespuestaNoIdentificada(input: RespuestaRecibidaInput) {
    if (input.automatica) {
      return { id: null, identificada: false as const, prospecto_id: null, envio_id: null, tardia: null, tarea_id: null, ya_existia: false as const };
    }
    const tarea = await this.tareasService.createFromAutomation({
      execution_id: `resp-noid-${createHash("sha256").update(input.execution_id).digest("hex").slice(0, 40)}`,
      tipo: "seguimiento",
      titulo: "Respuesta no identificada",
      descripcion: [`De: ${input.remitente ?? "(desconocido)"}`, `Para: ${input.reply_to}`, "", input.contenido ?? "(sin contenido)"].join("\n"),
      prioridad: "media"
    });
    return { id: null, identificada: false as const, prospecto_id: null, envio_id: null, tardia: null, tarea_id: tarea.id, ya_existia: tarea.ya_existia };
  }

  // --- Respuesta clasificada -------------------------------------------------------------
  // B2 (PLAN_API_DEFINITIVO.md #17): recibe el veredicto (IA o el criterio
  // que use n8n) y decide qué pasa con el prospecto. El caso "ambigua" no
  // fija un estado final: crea una tarea tipo=clasificacion que cae en la
  // bandeja `/cola-clasificacion` para que el Equipo CRM decida
  // manualmente (PLAN_N8N_DEFINITIVO.md B2). El resto se aplica con
  // aplicarClasificacionAlProspecto (compartida con la clasificación
  // manual): fija el estado del prospecto y, con "baja", suprime todos los
  // medios de su contacto en esta misma transacción. Antes la supresión la
  // hacía n8n como paso aparte: una obligación legal que dependía de un
  // segundo llamado que podía olvidarse o fallar solo (24-sep-2026).
  async clasificarRespuesta(input: RespuestaClasificadaInput) {
    const [respuesta] = await this.db
      .select({
        id: respuestas.id,
        prospectoId: respuestas.prospectoId,
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
      throw new HttpError(409, "La respuesta ya fue clasificada", CODIGO_RESPUESTA_YA_CLASIFICADA);
    }

    // Update de respuestas + update de prospectos + creación de la tarea
    // "ambigua" + auditoría van en una sola transacción: antes eran
    // escrituras sueltas, así que si createFromAutomation fallaba después
    // de confirmar respuestas.estado='clasificada', el retry idempotente
    // entraba por el early-return de arriba (estado ya es 'clasificada') y
    // nunca reintentaba crear la tarea perdida (hallazgo de code review,
    // 10-sep-2026).
    // La decisión se aplica con TareasService.aplicarClasificacionDeRespuesta,
    // la misma función que usa la clasificación manual. Su guarda
    // "pendiente" revalida el estado dentro del UPDATE: el guard de arriba
    // se lee ANTES de esta transacción, y sin revalidarlo dos POST
    // concurrentes para la misma respuesta (distinto execution_id) pasaban
    // ambos, y el segundo pisaba en silencio al primero (hallazgo de code
    // review, 14-sep-2026).
    //
    // A diferencia de la manual, no encola prospecto_clasificado: ese
    // evento es un aviso PARA n8n, y aquí quien clasificó es n8n. Además,
    // mientras N8N_WEBHOOK_URL no exista, cada evento termina en
    // procesos_fallidos: uno por respuesta llenaría esa bandeja de ruido.
    return this.db.transaction(async (tx) => {
      let aplicada: Awaited<ReturnType<TareasService["aplicarClasificacionDeRespuesta"]>>;
      try {
        aplicada = await this.tareasService.aplicarClasificacionDeRespuesta(tx, {
          prospectoId: respuesta.prospectoId,
          respuestaId: respuesta.id,
          clasificacion: input.clasificacion,
          comentario: input.comentario ?? null,
          contenido: respuesta.contenido,
          fechaSeguimiento: null,
          origen: { descripcion: `clasificación de n8n, respuesta ${respuesta.id}`, executionId: input.execution_id, usuarioId: null },
          guarda: "pendiente",
          tareaClasificacionId: null
        });
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new HttpError(409, "execution_id de clasificación ya usado en otra respuesta");
        }
        throw error;
      }
      const { supresionIds, tareaId } = aplicada;

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

  // --- Sugerencia de clasificación ------------------------------------------------------
  // Modo sugerencia (decisión del 30-sep-2026): la IA de n8n solo PROPONE.
  // Se guarda junto a la respuesta y la cola la muestra; una persona
  // confirma con POST /cola-clasificacion/:id/clasificar. No cambia el
  // estado del prospecto, no suprime ni cierra tareas: nada depende de la
  // IA mientras no se pase a modo directo (POST /respuestas/clasificacion).
  //
  // Va aparte de POST /respuestas a propósito: registrar la respuesta (lo
  // que detiene los recordatorios) no debe depender de que Gemini funcione.
  //
  // - Mismo execution_id que la sugerencia guardada: reintento, ya_existia
  //   (incluso si entretanto alguien ya clasificó la respuesta).
  // - Otro execution_id (se volvió a correr el workflow): sobrescribe; gana
  //   la última.
  // - Respuesta ya decidida: 409 RESPUESTA_YA_CLASIFICADA. Una "ambigua"
  //   sigue sin decidir (la resuelve la cola), así que sí acepta sugerencia.
  async registrarSugerencia(input: RespuestaSugeridaInput) {
    const [respuesta] = await this.db
      .select({
        id: respuestas.id,
        clasificacionSugerida: respuestas.clasificacionSugerida,
        confianzaSugerida: respuestas.confianzaSugerida,
        executionIdSugerencia: respuestas.executionIdSugerencia
      })
      .from(respuestas)
      .where(eq(respuestas.id, input.respuesta_id))
      .limit(1);
    if (!respuesta) throw new HttpError(404, "Respuesta no encontrada");

    if (respuesta.executionIdSugerencia === input.execution_id) {
      return { respuesta_id: respuesta.id, clasificacion_sugerida: respuesta.clasificacionSugerida, confianza_sugerida: respuesta.confianzaSugerida, sobrescrita: false, ya_existia: true as const };
    }

    // La revalidación va dentro del UPDATE: si una persona clasifica entre
    // la lectura de arriba y esta escritura, la sugerencia no se guarda.
    const [result] = await this.db.update(respuestas).set({
      clasificacionSugerida: input.clasificacion,
      confianzaSugerida: input.confianza,
      motivoSugerencia: input.motivo ?? null,
      executionIdSugerencia: input.execution_id,
      sugeridoEn: sql`CURRENT_TIMESTAMP`
    }).where(and(
      eq(respuestas.id, input.respuesta_id),
      or(ne(respuestas.estado, "clasificada"), eq(respuestas.clasificacion, "ambigua"))
    ));
    if (result.affectedRows === 0) {
      throw new HttpError(409, "La respuesta ya fue clasificada", CODIGO_RESPUESTA_YA_CLASIFICADA);
    }

    return { respuesta_id: respuesta.id, clasificacion_sugerida: input.clasificacion, confianza_sugerida: input.confianza, sobrescrita: respuesta.executionIdSugerencia !== null, ya_existia: false as const };
  }
}
