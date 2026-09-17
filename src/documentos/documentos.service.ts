import { Inject, Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { auditoria, catalogoTipoDocumento, contactos, documentos, empresas, oportunidades } from "../database/schema.js";
import { compactConditions } from "../shared/drizzle-utils.js";
import { HttpError } from "../shared/http-error.js";
import { env } from "../config/env.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { ALERTAS_BATCH_SIZE } from "../shared/jobs.js";
import { STORAGE_SERVICE } from "./storage/storage.constants.js";
import type { StorageService } from "./storage/storage.types.js";
import { EXTENSION_POR_MIME, TIPOS_MIME_PERMITIDOS, type CambiarEstadoDocumentoInput, type ListDocumentosQuery, type NuevaVersionDocumentoInput, type RevisarDocumentoInput, type SubirDocumentoInput } from "./dto/documento.schema.js";

/** Subconjunto de Express.Multer.File que de verdad usa el servicio (memoryStorage: sin destination/filename/path). */
export type ArchivoSubido = { originalname: string; mimetype: string; size: number; buffer: Buffer };

// Estados (PLAN_CRM_DEFINITIVO.md #8 no detalla el criterio, se define
// aquí): 'obsoleto' nunca es destino de un cambio de estado manual -- solo
// lo fija nuevaVersion(), igual criterio que cotizaciones (ver
// TRANSICIONES en cotizaciones.service.ts).
const TRANSICIONES: Record<string, string[]> = {
  vigente: ["archivado"],
  archivado: ["vigente"],
  obsoleto: []
};

// "Revisión de documentos pendientes" (PLAN_API_DEFINITIVO.md, "Jobs
// internos"): días sin PATCH .../revisar antes de alertar -- confirmado con
// Fabián (17-sep-2026), el plan no lo detalla.
const DIAS_PENDIENTE_REVISION = 7;

function toRow(row: typeof documentos.$inferSelect) {
  return {
    id: row.id,
    empresa_id: row.empresaId,
    oportunidad_id: row.oportunidadId,
    contacto_id: row.contactoId,
    documento_raiz_id: row.documentoRaizId,
    version: row.version,
    nombre_original: row.nombreOriginal,
    mime_type: row.mimeType,
    tipo_documento_id: row.tipoDocumentoId,
    tamano_bytes: row.tamanoBytes,
    estado: row.estado,
    politica_retencion: row.politicaRetencion,
    subido_por: row.subidoPor,
    revisado_por: row.revisadoPor,
    revisado_en: row.revisadoEn,
    creado_en: row.creadoEn,
    actualizado_en: row.actualizadoEn
  };
}

@Injectable()
export class DocumentosService {
  private readonly logger = new Logger(DocumentosService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDb,
    @Inject(STORAGE_SERVICE) private readonly storageService: StorageService,
    private readonly outboxService: OutboxService
  ) {}

  // Scoping (PLAN_CRM_DEFINITIVO.md no lo detalla para este módulo; se
  // adopta aquí el mismo criterio que EmpresasService, no el de
  // CotizacionesService): el expediente documental cuelga siempre de una
  // empresa (empresa_id NOT NULL; oportunidad_id/contacto_id son vínculos
  // opcionales), así que el agente ve/gestiona documentos de las empresas
  // de las que es propietario_id -- igual que "El agente ve sus empresas...
  // asignadas" (módulo 1) -- y no depende de si el documento además está
  // ligado a una oportunidad.
  private async validarEmpresaScoped(user: CurrentUser, empresaId: number) {
    const [empresa] = await this.db.select({ id: empresas.id, propietarioId: empresas.propietarioId }).from(empresas).where(and(eq(empresas.id, empresaId), eq(empresas.activo, true))).limit(1);
    if (!empresa || (user.rol === "agente" && empresa.propietarioId !== user.id)) {
      throw new HttpError(404, "Empresa no encontrada");
    }
    return empresa;
  }

  // También valida responsableId cuando quien sube es agente (hallazgo de
  // code review, 11-sep-2026): sin esto, un agente dueño de la empresa
  // podía adjuntar/ver documentos de una oportunidad de otro agente dentro
  // de la misma empresa, algo que CotizacionesService.validarOportunidad sí
  // impide para cotizaciones.
  private async validarOportunidad(user: CurrentUser, empresaId: number, oportunidadId: number) {
    const [row] = await this.db.select({ id: oportunidades.id, empresaId: oportunidades.empresaId, responsableId: oportunidades.responsableId }).from(oportunidades).where(eq(oportunidades.id, oportunidadId)).limit(1);
    if (!row || row.empresaId !== empresaId || (user.rol === "agente" && row.responsableId !== user.id)) {
      throw new HttpError(404, "Oportunidad no encontrada en esa empresa");
    }
  }

  private async validarTipoDocumento(tipoDocumentoId: number) {
    const [row] = await this.db.select({ id: catalogoTipoDocumento.id }).from(catalogoTipoDocumento).where(eq(catalogoTipoDocumento.id, tipoDocumentoId)).limit(1);
    if (!row) throw new HttpError(404, "Tipo de documento no encontrado");
  }

  // A diferencia de catalogos() en OportunidadesService (donde el resto de
  // la API referencia la etapa por clave, nunca por id), aquí se expone
  // también el id: subirDocumentoSchema/nuevaVersionDocumentoSchema piden
  // tipoDocumentoId numérico, mismo patrón que empresaId/oportunidadId/
  // contactoId en ese mismo body -- así que el cliente necesita el id, no
  // solo la clave, para poder enviarlo de vuelta.
  async catalogos() {
    const tiposDocumento = await this.db
      .select({ id: catalogoTipoDocumento.id, clave: catalogoTipoDocumento.clave, nombre: catalogoTipoDocumento.nombre })
      .from(catalogoTipoDocumento)
      .orderBy(catalogoTipoDocumento.nombre);
    return { tipos_documento: tiposDocumento };
  }

  private async validarContacto(empresaId: number, contactoId: number) {
    // eq(contactos.activo, true) agregado (hallazgo de code review,
    // 14-sep-2026): sin él, se podía subir un documento nuevo apuntando a
    // un contacto ya desactivado (EmpresasService.deactivateContact).
    const [row] = await this.db.select({ id: contactos.id }).from(contactos).where(and(eq(contactos.id, contactoId), eq(contactos.empresaId, empresaId), eq(contactos.activo, true))).limit(1);
    if (!row) throw new HttpError(404, "Contacto no encontrado en esa empresa");
  }

  private async obtenerScoped(user: CurrentUser, id: number) {
    // eq(empresas.activo, true) agregado (hallazgo de code review,
    // 11-sep-2026): sin él, una empresa dada de baja (soft-delete) seguía
    // dejando ver/descargar/versionar/archivar sus documentos por esta vía
    // -- validarEmpresaScoped() (usada en subir()/list()) sí lo exige, pero
    // get()/obtenerUrlDescarga()/nuevaVersion()/cambiarEstado()/revisar()/
    // eliminar() pasan todos por aquí, no por ahí.
    const [row] = await this.db
      .select({ documento: documentos, propietarioId: empresas.propietarioId })
      .from(documentos)
      .innerJoin(empresas, eq(empresas.id, documentos.empresaId))
      .where(and(eq(documentos.id, id), eq(documentos.activo, true), eq(empresas.activo, true)))
      .limit(1);
    if (!row || (user.rol === "agente" && row.propietarioId !== user.id)) {
      throw new HttpError(404, "Documento no encontrado");
    }
    return row.documento;
  }

  // "Tamaño inicial máximo: 25 MB... Tipos permitidos: PDF, DOCX, XLSX, PNG
  // y JPG" (PLAN_CRM_DEFINITIVO.md #8) -- se valida ANTES de tocar
  // storageService.subir(), para no gastar una subida (local o GCS) en un
  // archivo que de todas formas se va a rechazar.
  private validarArchivo(archivo: ArchivoSubido | undefined): asserts archivo is ArchivoSubido {
    if (!archivo) throw new HttpError(400, "Falta el archivo a subir (campo 'archivo')");
    if (!(TIPOS_MIME_PERMITIDOS as readonly string[]).includes(archivo.mimetype)) {
      throw new HttpError(400, `Tipo de archivo no permitido: ${archivo.mimetype}. Permitidos: PDF, DOCX, XLSX, PNG, JPG`);
    }
    const maxBytes = env.STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024;
    if (archivo.size > maxBytes) {
      throw new HttpError(400, `El archivo excede el tamaño máximo permitido (${env.STORAGE_MAX_FILE_SIZE_MB} MB)`);
    }
    if (archivo.size <= 0) throw new HttpError(400, "El archivo está vacío");
    // nombre_original es VARCHAR(255) NOT NULL (014_documentos.sql) -- sin
    // este chequeo, un nombre de archivo más largo (viene del
    // Content-Disposition del multipart, controlado por quien sube) pasaba
    // validarArchivo y tronaba con un "Data too long for column" crudo de
    // MySQL al insertar, dejando además el blob ya subido a storage
    // huérfano (hallazgo de code review, 11-sep-2026).
    if (archivo.originalname.length > 255) {
      throw new HttpError(400, "El nombre del archivo no puede exceder 255 caracteres");
    }
  }

  private buildStorageKey(empresaId: number, mimetype: string): string {
    // Key propia (UUID), no el nombre original: evita colisiones y
    // caracteres inseguros en el path/objeto de storage. nombre_original
    // se conserva aparte para mostrarlo y para el Content-Disposition de
    // la descarga. La extensión sale de EXTENSION_POR_MIME (mimetype ya
    // validado contra TIPOS_MIME_PERMITIDOS por validarArchivo()), no del
    // nombre de archivo que manda el cliente -- ver comentario en
    // EXTENSION_POR_MIME (hallazgo de code review, 14-sep-2026).
    const ext = EXTENSION_POR_MIME[mimetype as keyof typeof EXTENSION_POR_MIME] ?? "";
    return `documentos/${empresaId}/${randomUUID()}${ext}`;
  }

  async subir(user: CurrentUser, input: SubirDocumentoInput, archivo: ArchivoSubido | undefined) {
    this.validarArchivo(archivo);
    // Las cuatro validaciones son independientes entre sí (ninguna depende
    // del resultado de otra) -- Promise.all en vez de esperarlas una tras
    // otra, mismo criterio que ya se aplicó en reportes.service.ts
    // (hallazgo de code review, 11-sep-2026).
    await Promise.all([
      this.validarEmpresaScoped(user, input.empresaId),
      input.oportunidadId ? this.validarOportunidad(user, input.empresaId, input.oportunidadId) : Promise.resolve(),
      input.contactoId ? this.validarContacto(input.empresaId, input.contactoId) : Promise.resolve(),
      input.tipoDocumentoId ? this.validarTipoDocumento(input.tipoDocumentoId) : Promise.resolve()
    ]);

    const key = this.buildStorageKey(input.empresaId, archivo.mimetype);
    // Se sube el archivo ANTES de abrir la transacción de DB: si el insert
    // de metadatos fallara después, queda un blob huérfano en storage
    // (aceptable -- nada lo referencia, un futuro job de purga lo puede
    // barrer). El orden inverso (insertar primero) es peor: dejaría una
    // fila visible en GET/list apuntando a un archivo que nunca llegó a
    // subirse.
    await this.storageService.subir(key, { buffer: archivo.buffer, mimeType: archivo.mimetype, tamanoBytes: archivo.size });

    return this.db.transaction(async (tx) => {
      const [result] = await tx.insert(documentos).values({
        empresaId: input.empresaId,
        oportunidadId: input.oportunidadId ?? null,
        contactoId: input.contactoId ?? null,
        documentoRaizId: null,
        version: 1,
        nombreOriginal: archivo.originalname,
        mimeType: archivo.mimetype,
        tipoDocumentoId: input.tipoDocumentoId ?? null,
        tamanoBytes: archivo.size,
        storageDriver: env.STORAGE_DRIVER,
        storageKey: key,
        // input.politicaRetencion se validaba (subirDocumentoSchema) pero
        // nunca se guardaba aquí -- solo nuevaVersion() la persistía
        // (hallazgo de code review, 11-sep-2026).
        politicaRetencion: input.politicaRetencion ?? null,
        subidoPor: user.id
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: result.insertId,
        accion: "subir",
        despues: { empresa_id: input.empresaId, oportunidad_id: input.oportunidadId ?? null, nombre_original: archivo.originalname, mime_type: archivo.mimetype, tamano_bytes: archivo.size }
      });

      return { id: result.insertId, version: 1 };
    });
  }

  async list(user: CurrentUser, query: ListDocumentosQuery) {
    await this.validarEmpresaScoped(user, query.empresaId);
    const offset = (query.page - 1) * query.limit;

    const conditions = compactConditions([
      eq(documentos.empresaId, query.empresaId),
      eq(documentos.activo, true),
      // Solo la versión vigente de cada cadena por default, igual criterio
      // que cotizaciones: una versión obsoleta solo aparece explícitamente
      // en GET /documentos/:id/versiones.
      ne(documentos.estado, "obsoleto"),
      query.oportunidadId ? eq(documentos.oportunidadId, query.oportunidadId) : undefined,
      query.contactoId ? eq(documentos.contactoId, query.contactoId) : undefined
    ]);

    const rows = await this.db
      .select()
      .from(documentos)
      .where(and(...conditions))
      .orderBy(desc(documentos.actualizadoEn))
      .limit(query.limit)
      .offset(offset);

    return { page: query.page, limit: query.limit, data: rows.map(toRow) };
  }

  async get(user: CurrentUser, id: number) {
    const documento = await this.obtenerScoped(user, id);

    const raizId = documento.documentoRaizId ?? documento.id;
    const versiones = await this.db
      .select({ id: documentos.id, version: documentos.version, estado: documentos.estado, creadoEn: documentos.creadoEn })
      .from(documentos)
      .where(and(eq(documentos.activo, true), or(eq(documentos.id, raizId), eq(documentos.documentoRaizId, raizId))))
      .orderBy(documentos.version);

    return {
      ...toRow(documento),
      versiones: versiones.map((v) => ({ id: v.id, version: v.version, estado: v.estado, creado_en: v.creadoEn }))
    };
  }

  // "descarga" (PLAN_CRM_DEFINITIVO.md #8: "Cada carga, descarga...
  // queda auditado") se define como el momento en que se EMITE la URL
  // firmada, no el de la transferencia de bytes: con el driver GCS, una
  // vez emitida la URL firmada el archivo lo sirve GCS directamente (esta
  // API ya no está en el camino de esa petición), así que auditar "al
  // servir bytes" sería imposible de implementar igual para ambos drivers.
  // Auditar aquí, en el único punto que SÍ pasa siempre por esta API
  // (pedir la URL, con sesión y scoping ya validados), es lo que se puede
  // garantizar de forma uniforme entre local y gcs.
  async obtenerUrlDescarga(user: CurrentUser, id: number) {
    const documento = await this.obtenerScoped(user, id);

    const url = await this.storageService.urlFirmada(documento.storageKey, {
      nombreArchivo: documento.nombreOriginal,
      mimeType: documento.mimeType,
      ttlSegundos: env.STORAGE_SIGNED_URL_TTL_SECONDS
    });

    await this.db.insert(auditoria).values({
      usuarioId: user.id,
      entidad: "documento",
      entidadId: id,
      accion: "descargar",
      despues: { version: documento.version }
    });

    return { url, expira_en_segundos: env.STORAGE_SIGNED_URL_TTL_SECONDS };
  }

  async nuevaVersion(user: CurrentUser, id: number, input: NuevaVersionDocumentoInput, archivo: ArchivoSubido | undefined) {
    this.validarArchivo(archivo);
    const actual = await this.obtenerScoped(user, id);
    if (actual.estado === "obsoleto") throw new HttpError(409, "No se puede versionar un documento ya obsoleto");
    if (input.tipoDocumentoId) await this.validarTipoDocumento(input.tipoDocumentoId);

    const raizId = actual.documentoRaizId ?? actual.id;
    const nuevaVersionNum = actual.version + 1;
    const key = this.buildStorageKey(actual.empresaId, archivo.mimetype);
    await this.storageService.subir(key, { buffer: archivo.buffer, mimeType: archivo.mimetype, tamanoBytes: archivo.size });

    return this.db.transaction(async (tx) => {
      // obtenerScoped() validó el estado fuera de cualquier bloqueo -- dos
      // POST .../version concurrentes podían leer ambos estado='vigente' y
      // terminar insertando dos filas "vigentes". Revalidar dentro del
      // propio UPDATE (WHERE ... AND estado != 'obsoleto') y chequear
      // affectedRows cierra la carrera, mismo patrón que
      // CotizacionesService.nuevaVersion (hallazgo de code review,
      // 11-sep-2026, aplicado aquí desde el inicio).
      const [marcarObsoleto] = await tx.update(documentos).set({ estado: "obsoleto" }).where(and(eq(documentos.id, actual.id), ne(documentos.estado, "obsoleto")));
      if (marcarObsoleto.affectedRows === 0) {
        throw new HttpError(409, "El documento ya fue versionado o marcado obsoleto por otra solicitud");
      }

      const [result] = await tx.insert(documentos).values({
        empresaId: actual.empresaId,
        oportunidadId: actual.oportunidadId,
        contactoId: actual.contactoId,
        documentoRaizId: raizId,
        version: nuevaVersionNum,
        nombreOriginal: archivo.originalname,
        mimeType: archivo.mimetype,
        tipoDocumentoId: input.tipoDocumentoId ?? actual.tipoDocumentoId,
        tamanoBytes: archivo.size,
        storageDriver: env.STORAGE_DRIVER,
        storageKey: key,
        politicaRetencion: input.politicaRetencion ?? actual.politicaRetencion,
        subidoPor: user.id
      });

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: result.insertId,
        accion: "nueva_version",
        antes: { documento_anterior_id: actual.id, estado_anterior: actual.estado },
        despues: { version: nuevaVersionNum, nombre_original: archivo.originalname }
      });

      return { id: result.insertId, version: nuevaVersionNum };
    });
  }

  async cambiarEstado(user: CurrentUser, id: number, input: CambiarEstadoDocumentoInput) {
    const documento = await this.obtenerScoped(user, id);
    const permitidas = TRANSICIONES[documento.estado] ?? [];
    if (!permitidas.includes(input.estado)) {
      throw new HttpError(409, `No se puede pasar de '${documento.estado}' a '${input.estado}'`);
    }

    await this.db.transaction(async (tx) => {
      // Misma revalidación con affectedRows que nuevaVersion() -- ver
      // comentario ahí. Al volver a 'vigente' se limpia alertado_en: sin
      // esto, un documento nunca revisado que se archiva y se reactiva
      // queda excluido de alertarDocumentosPendientes() para siempre --
      // esa consulta filtra alertado_en IS NULL, y esta era la única fila
      // que lo dejaba en NULL o no según haya pasado por el job antes de
      // archivarse (hallazgo de code-review, 17-sep-2026). revisado_en NO
      // se toca: si ya se había revisado antes de archivar, sigue revisado.
      const [result] = await tx.update(documentos).set({
        estado: input.estado,
        ...(input.estado === "vigente" ? { alertadoEn: null } : {})
      }).where(and(eq(documentos.id, id), eq(documentos.estado, documento.estado)));
      if (result.affectedRows === 0) {
        throw new HttpError(409, "El estado del documento cambió, vuelve a intentarlo");
      }

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: id,
        accion: "cambiar_estado",
        antes: { estado: documento.estado },
        despues: { estado: input.estado }
      });
    });

    return this.get(user, id);
  }

  // "revisión" (PLAN_CRM_DEFINITIVO.md #8 no lo detalla): se define como
  // una confirmación explícita de que alguien del equipo revisó el
  // documento (quién y cuándo, con comentario opcional) -- una acción
  // deliberada vía PATCH, no cada GET de metadatos. Auditar cada lectura
  // de GET /documentos/:id inflaría la tabla `auditoria` con tráfico de
  // solo-lectura y no distinguiría "alguien listó la tabla" de "alguien
  // realmente revisó el contenido", que es lo que el plan pide poder
  // rastrear.
  async revisar(user: CurrentUser, id: number, input: RevisarDocumentoInput) {
    await this.obtenerScoped(user, id);

    await this.db.transaction(async (tx) => {
      // sql`CURRENT_TIMESTAMP` (hora del propio MySQL), no `new Date()` en
      // Node -- mismo motivo que fechaEmision en CotizacionesService: evita
      // el desfase de zona horaria de un valor calculado en el servidor de
      // la API.
      await tx.update(documentos).set({ revisadoPor: user.id, revisadoEn: sql`CURRENT_TIMESTAMP` }).where(eq(documentos.id, id));

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: id,
        accion: "revisar",
        despues: { comentario: input.comentario ?? null }
      });
    });

    return this.get(user, id);
  }

  // "Revisión de documentos pendientes" (PLAN_API_DEFINITIVO.md, "Jobs
  // internos"): documentos vigentes con más de DIAS_PENDIENTE_REVISION días
  // sin que nadie los marque revisados. @Interval fijo diario, mismo
  // criterio que ProspectosService.limpiarBorradoresVencidos -- sin
  // endpoint de disparo manual, porque es housekeeping y no algo que
  // alguien necesite forzar a mano (a diferencia del despachador de
  // outbox o del job de métricas). No llama a n8n directamente: encola un
  // evento en eventos_pendientes (mismo patrón outbox que
  // TareasService.cerrar/clasificar) para que n8n decida el canal real de
  // aviso. alertado_en evita reencolar el mismo documento cada día -- ver
  // comentario en 019_alertas_sla.sql.
  @Interval(24 * 60 * 60 * 1000)
  async alertarDocumentosPendientes() {
    const candidatos = await this.db
      .select({ id: documentos.id, empresaId: documentos.empresaId, nombreOriginal: documentos.nombreOriginal, creadoEn: documentos.creadoEn })
      .from(documentos)
      .where(and(
        eq(documentos.estado, "vigente"),
        eq(documentos.activo, true),
        isNull(documentos.revisadoEn),
        isNull(documentos.alertadoEn),
        sql`${documentos.creadoEn} < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL ${DIAS_PENDIENTE_REVISION} DAY)`
      ))
      .limit(ALERTAS_BATCH_SIZE);

    let alertados = 0;
    for (const documento of candidatos) {
      const encolado = await this.db.transaction(async (tx) => {
        // CAS: mismo criterio que cualquier otro UPDATE-y-efecto-colateral
        // de este proyecto (nuevaVersion, cambiarEstado, tareas.cerrar) --
        // cierra la carrera teórica de dos corridas del job solapándose.
        const [result] = await tx.update(documentos).set({ alertadoEn: sql`CURRENT_TIMESTAMP` }).where(and(eq(documentos.id, documento.id), isNull(documentos.alertadoEn)));
        if (result.affectedRows === 0) return false;

        await this.outboxService.enqueue(tx, {
          tipo: "documento_pendiente_revision",
          entidadTipo: "documento",
          entidadId: documento.id,
          payload: { documento_id: documento.id, empresa_id: documento.empresaId, nombre_original: documento.nombreOriginal, creado_en: documento.creadoEn }
        });
        return true;
      });
      if (encolado) alertados++;
    }

    if (alertados > 0) this.logger.log(`${alertados} documento(s) pendiente(s) de revisión alertados`);
    return alertados;
  }

  // Soft-delete, mismo patrón que empresas/contactos (activo=false) -- ver
  // comentario en 014_documentos.sql. No purga el archivo de storage (eso
  // queda para un futuro job de retención); administrador y supervisor
  // solamente (no agente): retirar un documento del expediente es una
  // acción más sensible que subir uno, criterio ya usado para
  // /api/v1/reportes (solo roles con visión agregada/administrativa) --
  // ver DocumentosController.
  async eliminar(user: CurrentUser, id: number) {
    const documento = await this.obtenerScoped(user, id);

    await this.db.transaction(async (tx) => {
      await tx.update(documentos).set({ activo: false }).where(eq(documentos.id, id));

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: id,
        accion: "eliminar",
        antes: { estado: documento.estado }
      });
    });
  }
}
