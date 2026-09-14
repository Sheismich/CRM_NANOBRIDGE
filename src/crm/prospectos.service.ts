import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { and, eq, inArray, like, lt, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, borradoresCaptura, campanas, contactos, empresas, mediosContacto, prospectos } from "../database/schema.js";
import { HttpError } from "../shared/http-error.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { insertarMediosContacto } from "../shared/medios-contacto.js";
import { normalizeEmail, normalizePhone } from "../shared/normalize.js";
import { parseCsv } from "../shared/csv.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { filaCsvSchema, type FilaCsv, type ListBorradoresQuery, type ListProspectosQuery, type ProspectoInput } from "./dto/prospecto.schema.js";

const BORRADORES_TTL_DIAS = 30;
// Tope defensivo por importación: STEELSAFE (el primer caso de uso real)
// trae 30 filas; 2000 deja margen amplio sin permitir que un archivo
// gigante bloquee la petición completa fila por fila (cada una hace al
// menos un SELECT de deduplicación).
const CSV_MAX_FILAS = 2000;

type ErrorFila = { campo: string; mensaje: string };
type BorradorRow = typeof borradoresCaptura.$inferSelect;

type Candidato = {
  numero: number;
  filaOriginal: Record<string, unknown>;
  fila: FilaCsv | ProspectoInput | null;
  errores: ErrorFila[] | null;
};

@Injectable()
export class ProspectosService {
  private readonly logger = new Logger(ProspectosService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // --- Alta manual: PLAN_CRM_DEFINITIVO.md #3 la agrupa con la importación
  // CSV bajo el mismo mecanismo de borradores ("los borradores viven en
  // borradores_captura") -- una alta manual es, en los hechos, un lote de
  // una sola fila, así que reusa exactamente el mismo camino de
  // validación/deduplicación que una fila de CSV en vez de tener su
  // propia copia.
  async crearManual(user: CurrentUser, input: ProspectoInput) {
    const loteId = randomUUID();
    const [borrador] = await this.crearBorradores(user, loteId, "manual", [
      { numero: 1, filaOriginal: input as Record<string, unknown>, fila: input, errores: null }
    ]);
    return this.toJson(borrador!);
  }

  // --- Importación CSV --------------------------------------------------
  async importarCsv(user: CurrentUser, archivo: Express.Multer.File | undefined, campanaIdDefault: number | undefined) {
    if (!archivo || archivo.buffer.length === 0) throw new HttpError(400, "Falta el archivo CSV (campo 'archivo')");

    if (campanaIdDefault) {
      const [campana] = await this.db.select({ id: campanas.id }).from(campanas).where(eq(campanas.id, campanaIdDefault)).limit(1);
      if (!campana) throw new HttpError(404, "Campaña no encontrada");
    }

    const filas = parseCsv(archivo.buffer.toString("utf-8"));
    if (filas.length === 0) throw new HttpError(400, "El CSV no tiene filas de datos (¿le falta la fila de encabezados?)");
    if (filas.length > CSV_MAX_FILAS) throw new HttpError(400, `El CSV tiene ${filas.length} filas; el máximo por importación es ${CSV_MAX_FILAS}`);

    const loteId = randomUUID();
    const candidatos: Candidato[] = filas.map((filaOriginal, i) => {
      const conCampanaDefault = campanaIdDefault && !filaOriginal.campanaId ? { ...filaOriginal, campanaId: String(campanaIdDefault) } : filaOriginal;
      const resultado = filaCsvSchema.safeParse(conCampanaDefault);
      return {
        numero: i + 2, // +2: fila 1 es el encabezado, así el número coincide con la fila real del archivo abierto en una hoja de cálculo
        filaOriginal,
        fila: resultado.success ? resultado.data : null,
        errores: resultado.success ? null : resultado.error.issues.map((issue) => ({ campo: issue.path.join(".") || "(fila)", mensaje: issue.message }))
      };
    });

    const insertados = await this.crearBorradores(user, loteId, archivo.originalname || "importacion.csv", candidatos);

    const resumen: Record<string, number> = {};
    for (const b of insertados) resumen[b.estado] = (resumen[b.estado] ?? 0) + 1;

    return { lote_id: loteId, fuente: archivo.originalname || "importacion.csv", total: insertados.length, resumen };
  }

  // Núcleo compartido por crearManual() e importarCsv(): valida (ya viene
  // validado en `fila`/`errores`), deduplica -- primero contra otras
  // filas del mismo lote, luego contra medios_contacto en BD, en ese
  // orden, siguiendo "coincidencia de duplicados por correo normalizado y
  // después por teléfono normalizado" (PLAN_CRM_DEFINITIVO.md #3) -- e
  // inserta cada fila como borrador. Nunca toca empresas/contactos/
  // prospectos: eso solo ocurre en confirmarFila().
  private async crearBorradores(user: CurrentUser, loteId: string, fuente: string, candidatos: Candidato[]): Promise<BorradorRow[]> {
    const expiraEn = new Date(Date.now() + BORRADORES_TTL_DIAS * 24 * 60 * 60 * 1000);
    // Recuerda qué fila del lote ya "ocupó" cada correo/teléfono normalizado,
    // para detectar duplicados dentro del propio archivo (ej. dos cuentas
    // STEELSAFE que comparten el mismo teléfono general de conmutador).
    const vistosEnLote = new Map<string, number>();
    const resultados: BorradorRow[] = [];

    for (const candidato of candidatos) {
      if (!candidato.fila) {
        resultados.push(
          await this.insertarBorrador(user, loteId, fuente, candidato, expiraEn, {
            estado: "rechazado",
            matchContactoId: null,
            matchMotivo: null,
            errores: candidato.errores
          })
        );
        continue;
      }

      const fila = candidato.fila;
      const correoNormalizado = fila.correo ? normalizeEmail(fila.correo) : null;
      const telefonoNormalizado = fila.telefono ? normalizePhone(fila.telefono) : null;
      const claveLote = correoNormalizado ? `correo:${correoNormalizado}` : telefonoNormalizado ? `telefono:${telefonoNormalizado}` : null;
      const filaPrevia = claveLote ? vistosEnLote.get(claveLote) : undefined;

      let estado: "pendiente_revision" | "duplicado" = "pendiente_revision";
      let matchContactoId: number | null = null;
      let matchMotivo: "correo" | "telefono" | null = null;
      let errores: ErrorFila[] | null = null;

      if (filaPrevia !== undefined) {
        estado = "duplicado";
        errores = [{ campo: "correo/telefono", mensaje: `Mismo correo o teléfono que la fila ${filaPrevia} de este mismo archivo` }];
      } else {
        const [match] = await this.db
          .select({ contactoId: contactos.id, esCorreo: sql<number>`(${mediosContacto.tipo} = 'correo')` })
          .from(mediosContacto)
          .innerJoin(contactos, eq(contactos.id, mediosContacto.contactoId))
          .where(
            sql`(${mediosContacto.tipo} = 'correo' AND ${mediosContacto.valorNormalizado} = ${correoNormalizado}) OR (${mediosContacto.tipo} = 'telefono' AND ${mediosContacto.valorNormalizado} = ${telefonoNormalizado})`
          )
          .orderBy(sql`(${mediosContacto.tipo} = 'correo') DESC`)
          .limit(1);

        if (match) {
          estado = "duplicado";
          matchContactoId = match.contactoId;
          matchMotivo = match.esCorreo ? "correo" : "telefono";
        }
      }

      if (claveLote) vistosEnLote.set(claveLote, candidato.numero);

      resultados.push(
        await this.insertarBorrador(user, loteId, fuente, candidato, expiraEn, { estado, matchContactoId, matchMotivo, errores }, { correoNormalizado, telefonoNormalizado })
      );
    }

    return resultados;
  }

  private async insertarBorrador(
    user: CurrentUser,
    loteId: string,
    fuente: string,
    candidato: Candidato,
    expiraEn: Date,
    resultado: { estado: "pendiente_revision" | "duplicado" | "rechazado"; matchContactoId: number | null; matchMotivo: "correo" | "telefono" | null; errores: ErrorFila[] | null },
    normalizados?: { correoNormalizado: string | null; telefonoNormalizado: string | null }
  ): Promise<BorradorRow> {
    const fila = candidato.fila;
    const [inserted] = await this.db.insert(borradoresCaptura).values({
      loteId,
      fuente,
      filaNumero: candidato.numero,
      filaOriginal: candidato.filaOriginal,
      empresaNombreLegal: fila?.empresaNombreLegal ?? null,
      empresaGiro: fila?.empresaGiro ?? null,
      empresaTamano: fila?.empresaTamano ?? null,
      empresaRegion: fila?.empresaRegion ?? null,
      empresaEstado: fila?.empresaEstado ?? null,
      empresaCiudad: fila?.empresaCiudad ?? null,
      empresaPais: fila?.empresaPais?.toUpperCase() ?? "MX",
      empresaSitioWeb: fila?.empresaSitioWeb ?? null,
      contactoNombre: fila?.contactoNombre ?? null,
      contactoPuesto: fila?.contactoPuesto ?? null,
      correo: fila?.correo ?? null,
      correoNormalizado: normalizados?.correoNormalizado ?? null,
      telefono: fila?.telefono ?? null,
      telefonoNormalizado: normalizados?.telefonoNormalizado ?? null,
      canalInicial: fila?.canalInicial ?? null,
      confianza: fila?.confianza ?? null,
      prioridad: fila?.prioridad ?? null,
      score: fila?.score !== undefined ? fila.score.toFixed(2) : null,
      fuenteUrl: fila?.fuenteUrl ?? null,
      observaciones: fila?.observaciones ?? null,
      estado: resultado.estado,
      matchContactoId: resultado.matchContactoId,
      matchMotivo: resultado.matchMotivo,
      errores: resultado.errores,
      campanaId: fila?.campanaId ?? null,
      creadoPor: user.id,
      expiraEn
    });

    const [row] = await this.db.select().from(borradoresCaptura).where(eq(borradoresCaptura.id, inserted.insertId)).limit(1);
    return row!;
  }

  // --- Revisión de un lote -------------------------------------------------
  async listarBorradores(user: CurrentUser, loteId: string, query: ListBorradoresQuery) {
    const condition = compactConditions([
      eq(borradoresCaptura.loteId, loteId),
      query.estado ? eq(borradoresCaptura.estado, query.estado) : undefined,
      user.rol === "agente" ? eq(borradoresCaptura.creadoPor, user.id) : undefined
    ]);
    const rows = await this.db
      .select()
      .from(borradoresCaptura)
      .where(and(...condition))
      .orderBy(borradoresCaptura.filaNumero);

    if (rows.length === 0) throw new HttpError(404, "Lote no encontrado");
    return { lote_id: loteId, total: rows.length, filas: rows.map((r) => this.toJson(r)) };
  }

  // Confirma que el usuario puede operar sobre este lote antes de dejar que
  // confirmarFila/rechazarFila/confirmarTodos lo toquen: un agente solo
  // sobre lo que él mismo importó (mismo criterio que
  // EmpresasService.assertOwnership, aplicado aquí por lote en vez de por
  // fila individual porque todas las filas de un lote comparten
  // creado_por).
  private async assertLoteOwnership(user: CurrentUser, loteId: string) {
    if (user.rol === "agente") {
      const [alguna] = await this.db.select({ id: borradoresCaptura.id }).from(borradoresCaptura).where(and(eq(borradoresCaptura.loteId, loteId), eq(borradoresCaptura.creadoPor, user.id))).limit(1);
      if (!alguna) throw new HttpError(404, "Lote no encontrado");
    }
  }

  // --- Confirmar: promueve un borrador a empresa+contacto+prospecto real ---
  // usarContactoExistente=true es obligatorio para confirmar una fila
  // 'duplicado' que sí coincidió con un contacto en BD (matchContactoId) --
  // así nunca se reutiliza un contacto existente por accidente
  // (PLAN_CRM_DEFINITIVO.md: "la razón social nunca fusiona prospectos
  // automáticamente", mismo criterio aplicado aquí a nivel de contacto).
  // Una fila 'duplicado' SIN matchContactoId (coincide con otra fila del
  // mismo lote, que todavía no es un contacto real) no se puede confirmar
  // así: primero hay que confirmar o rechazar la otra fila.
  async confirmarFila(user: CurrentUser, loteId: string, id: number, usarContactoExistente: boolean) {
    await this.assertLoteOwnership(user, loteId);
    return this.db.transaction(async (tx) => {
      const [borrador] = await tx
        .select()
        .from(borradoresCaptura)
        .where(and(eq(borradoresCaptura.id, id), eq(borradoresCaptura.loteId, loteId)))
        .limit(1)
        .for("update");
      if (!borrador) throw new HttpError(404, "Fila no encontrada en este lote");
      if (borrador.estado === "importado") return { id: borrador.prospectoId, ya_existia: true as const };
      if (borrador.estado !== "pendiente_revision" && borrador.estado !== "duplicado") {
        throw new HttpError(409, `La fila está en estado '${borrador.estado}' y ya no se puede confirmar`);
      }
      if (!borrador.empresaNombreLegal || !borrador.contactoNombre || !borrador.canalInicial) {
        throw new HttpError(409, "La fila no pasó validación (falta empresa, contacto o canal) y no se puede confirmar; corrígela y vuelve a importarla, o recházala");
      }

      let contactoId: number;
      let empresaId: number;

      if (borrador.estado === "duplicado") {
        if (!usarContactoExistente) {
          throw new HttpError(409, "Esta fila coincide con un contacto existente o con otra fila del archivo; confirma con usar_contacto_existente=true para reutilizarlo, o recházala");
        }
        if (!borrador.matchContactoId) {
          throw new HttpError(409, "Esta fila duplica otra fila del mismo archivo que todavía no ha sido confirmada ni rechazada; resuelve esa otra fila primero");
        }
        const [contacto] = await tx.select({ id: contactos.id, empresaId: contactos.empresaId }).from(contactos).where(eq(contactos.id, borrador.matchContactoId)).limit(1);
        if (!contacto) throw new HttpError(409, "El contacto con el que coincidía esta fila ya no existe");
        contactoId = contacto.id;
        empresaId = contacto.empresaId;
      } else {
        const [empresa] = await tx.insert(empresas).values({
          nombreLegal: borrador.empresaNombreLegal,
          giro: borrador.empresaGiro,
          tamano: borrador.empresaTamano,
          region: borrador.empresaRegion,
          estado: borrador.empresaEstado,
          ciudad: borrador.empresaCiudad,
          pais: borrador.empresaPais,
          sitioWeb: borrador.empresaSitioWeb,
          propietarioId: user.id
        });
        empresaId = empresa.insertId;

        const [contacto] = await tx.insert(contactos).values({
          empresaId,
          nombre: borrador.contactoNombre,
          puesto: borrador.contactoPuesto
        });
        contactoId = contacto.insertId;

        await insertarMediosContacto(tx, contactoId, [
          { tipo: "correo", valor: borrador.correo ?? undefined, valorNormalizado: borrador.correoNormalizado },
          // El teléfono se registra como whatsapp o como telefono según el
          // canal declarado en la fila -- el borrador solo guarda un
          // número, no dos.
          { tipo: borrador.canalInicial === "whatsapp" ? "whatsapp" : "telefono", valor: borrador.telefono ?? undefined, valorNormalizado: borrador.telefonoNormalizado }
        ]);
      }

      const [prospecto] = await tx.insert(prospectos).values({
        contactoId,
        campanaId: borrador.campanaId,
        estado: "capturado",
        score: borrador.score,
        prioridad: borrador.prioridad,
        fuenteUrl: borrador.fuenteUrl,
        confianza: borrador.confianza
      });

      await tx
        .update(borradoresCaptura)
        .set({ estado: "importado", prospectoId: prospecto.insertId, procesadoEn: sql`CURRENT_TIMESTAMP`, procesadoPor: user.id })
        .where(eq(borradoresCaptura.id, id));

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "prospecto",
        entidadId: prospecto.insertId,
        accion: "importar_borrador",
        despues: { borrador_id: id, lote_id: loteId, empresa_id: empresaId, contacto_id: contactoId, reutilizo_contacto: borrador.estado === "duplicado" }
      });

      return { id: prospecto.insertId, contacto_id: contactoId, empresa_id: empresaId, ya_existia: false as const };
    });
  }

  async confirmarTodos(user: CurrentUser, loteId: string) {
    await this.assertLoteOwnership(user, loteId);
    const pendientes = await this.db
      .select({ id: borradoresCaptura.id })
      .from(borradoresCaptura)
      .where(and(eq(borradoresCaptura.loteId, loteId), eq(borradoresCaptura.estado, "pendiente_revision")));
    if (pendientes.length === 0) throw new HttpError(404, "El lote no tiene filas pendientes de revisión (las 'duplicado' se confirman una por una)");

    const resultados: { id: number; ok: boolean; error?: string }[] = [];
    for (const { id } of pendientes) {
      try {
        const r = await this.confirmarFila(user, loteId, id, false);
        resultados.push({ id: r.id!, ok: true });
      } catch (error) {
        resultados.push({ id, ok: false, error: error instanceof HttpError ? error.message : "Error inesperado" });
      }
    }

    return { lote_id: loteId, total: resultados.length, confirmados: resultados.filter((r) => r.ok).length, resultados };
  }

  async rechazarFila(user: CurrentUser, loteId: string, id: number) {
    await this.assertLoteOwnership(user, loteId);
    const [result] = await this.db
      .update(borradoresCaptura)
      .set({ estado: "rechazado", procesadoEn: sql`CURRENT_TIMESTAMP`, procesadoPor: user.id })
      .where(and(eq(borradoresCaptura.id, id), eq(borradoresCaptura.loteId, loteId), inArray(borradoresCaptura.estado, ["pendiente_revision", "duplicado"])));
    if (result.affectedRows === 0) throw new HttpError(404, "Fila no encontrada en ese lote, o ya no está pendiente");
  }

  // Limpieza de borradores vencidos (PLAN_API_DEFINITIVO.md, "Jobs
  // internos"): corre una vez al día, igual de espíritu que
  // OutboxDispatcherService pero con @Interval fijo en vez de env var --
  // no hay ningún caso de negocio que requiera ajustarlo en runtime, a
  // diferencia del despachador de outbox (ese sí necesita tunearse según
  // la disponibilidad real de n8n).
  @Interval(24 * 60 * 60 * 1000)
  async limpiarBorradoresVencidos() {
    const [result] = await this.db
      .update(borradoresCaptura)
      .set({ estado: "expirado" })
      .where(and(inArray(borradoresCaptura.estado, ["pendiente_revision", "duplicado"]), lt(borradoresCaptura.expiraEn, sql`CURRENT_TIMESTAMP`)));
    if (result.affectedRows > 0) this.logger.log(`${result.affectedRows} borrador(es) marcados como expirados`);
    return result.affectedRows;
  }

  // --- Prospectos ya confirmados --------------------------------------------
  async listProspectos(user: CurrentUser, query: ListProspectosQuery) {
    const offset = (query.page - 1) * query.limit;
    const ownsOnly = user.rol === "agente";

    const condition = compactConditions([
      ownsOnly ? eq(empresas.propietarioId, user.id) : undefined,
      query.estado ? eq(prospectos.estado, query.estado) : undefined,
      query.prioridad ? eq(prospectos.prioridad, query.prioridad) : undefined,
      query.q ? or(like(empresas.nombreLegal, `%${query.q}%`), like(contactos.nombre, `%${query.q}%`)) : undefined
    ]);

    const rows = await this.db
      .select({
        id: prospectos.id,
        estado: prospectos.estado,
        score: prospectos.score,
        prioridad: prospectos.prioridad,
        confianza: prospectos.confianza,
        contacto_id: contactos.id,
        contacto_nombre: contactos.nombre,
        empresa_id: empresas.id,
        empresa_nombre_legal: empresas.nombreLegal,
        creado_en: prospectos.creadoEn
      })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(and(...condition))
      .orderBy(prospectos.creadoEn)
      .limit(query.limit)
      .offset(offset);

    return { page: query.page, limit: query.limit, data: rows };
  }

  async getProspecto(user: CurrentUser, id: number) {
    const ownsOnly = user.rol === "agente";
    const [row] = await this.db
      .select({
        id: prospectos.id,
        estado: prospectos.estado,
        score: prospectos.score,
        prioridad: prospectos.prioridad,
        confianza: prospectos.confianza,
        fuenteUrl: prospectos.fuenteUrl,
        campanaId: prospectos.campanaId,
        creadoEn: prospectos.creadoEn,
        contactoId: contactos.id,
        contactoNombre: contactos.nombre,
        contactoPuesto: contactos.puesto,
        empresaId: empresas.id,
        empresaNombreLegal: empresas.nombreLegal,
        empresaPropietarioId: empresas.propietarioId
      })
      .from(prospectos)
      .innerJoin(contactos, eq(contactos.id, prospectos.contactoId))
      .innerJoin(empresas, eq(empresas.id, contactos.empresaId))
      .where(eq(prospectos.id, id))
      .limit(1);

    if (!row || (ownsOnly && row.empresaPropietarioId !== user.id)) throw new HttpError(404, "Prospecto no encontrado");

    const medios = await this.db
      .select({ tipo: mediosContacto.tipo, valor: mediosContacto.valor, estado_contacto: mediosContacto.estadoContacto })
      .from(mediosContacto)
      .where(eq(mediosContacto.contactoId, row.contactoId));

    return {
      id: row.id,
      estado: row.estado,
      score: row.score,
      prioridad: row.prioridad,
      confianza: row.confianza,
      fuente_url: row.fuenteUrl,
      campana_id: row.campanaId,
      creado_en: row.creadoEn,
      contacto: { id: row.contactoId, nombre: row.contactoNombre, puesto: row.contactoPuesto, medios },
      empresa: { id: row.empresaId, nombre_legal: row.empresaNombreLegal }
    };
  }

  private toJson(row: BorradorRow) {
    return {
      id: row.id,
      lote_id: row.loteId,
      fuente: row.fuente,
      fila_numero: row.filaNumero,
      empresa_nombre_legal: row.empresaNombreLegal,
      contacto_nombre: row.contactoNombre,
      correo: row.correo,
      telefono: row.telefono,
      canal_inicial: row.canalInicial,
      confianza: row.confianza,
      prioridad: row.prioridad,
      score: row.score,
      estado: row.estado,
      match_contacto_id: row.matchContactoId,
      match_motivo: row.matchMotivo,
      errores: row.errores,
      prospecto_id: row.prospectoId,
      creado_en: row.creadoEn,
      expira_en: row.expiraEn
    };
  }
}
