import { Inject, Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, like, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { DRIZZLE, type DrizzleDb, type DrizzleTx } from "../database/drizzle.constants.js";
import { auditoria, catalogoEtapaEmbudo, catalogoTipoDocumento, contactos, cotizaciones, documentos, empresas, oportunidades, tareas, usuarios } from "../database/schema.js";
import { CLAVE_COTIZACION_FIRMADA, evaluarVenta, type DocumentoDeExpediente } from "./expediente.js";
import { compactConditions, patronLike } from "../shared/drizzle-utils.js";
import { HttpError } from "../shared/http-error.js";
import { env } from "../config/env.js";
import type { CurrentUser } from "../auth/current-user.type.js";
import { OutboxService } from "../outbox/outbox.service.js";
import { ALERTAS_BATCH_SIZE } from "../shared/jobs.js";
import { finSiguienteDiaHabilMx } from "../shared/dia-habil.js";
import { MOTIVOS_RECHAZO_DOCUMENTO, NOMBRE_MOTIVO_RECHAZO_DOCUMENTO } from "../shared/motivos-rechazo-documento.js";
import { STORAGE_SERVICE } from "./storage/storage.constants.js";
import type { StorageService } from "./storage/storage.types.js";
import { contenidoEsDelTipo, nombreDeDescarga } from "./tipo-de-archivo.js";
import { enlaceTarea, notificar } from "../notificaciones/notificar.js";
import { EXTENSION_POR_MIME, TIPOS_MIME_PERMITIDOS, type CambiarEstadoDocumentoInput, type CambiarObligatorioInput, type ListDocumentosQuery, type LoteDocumentosQuery, type ModoDescarga, type NuevaVersionDocumentoInput, type RechazarDocumentoInput, type RevisarDocumentoInput, type SubirDocumentoInput } from "./dto/documento.schema.js";

/** Subconjunto de Express.Multer.File que de verdad usa el servicio (memoryStorage: sin destination/filename/path). */
export type ArchivoSubido = { originalname: string; mimetype: string; size: number; buffer: Buffer };

export const CODIGO_DOCUMENTO_NO_VIGENTE = "DOCUMENTO_NO_VIGENTE";
export const CODIGO_VISTA_PREVIA_NO_DISPONIBLE = "VISTA_PREVIA_NO_DISPONIBLE";
export const CODIGO_LOTE_DEMASIADO_GRANDE = "LOTE_DEMASIADO_GRANDE";
export const CODIGO_OPORTUNIDAD_REQUERIDA = "OPORTUNIDAD_REQUERIDA";

// Vista previa (?modo=ver): solo lo que un navegador sabe mostrar. Word y
// Excel se descargan.
const MIME_CON_VISTA_PREVIA: readonly string[] = ["application/pdf", "image/png", "image/jpeg"];

// Descargar lote (Fabián, 12-oct-2026): el zip pasa por Firebase y Cloud Run;
// con más que esto se pide filtrar más.
export const LOTE_MAX_ARCHIVOS = 100;
export const LOTE_MAX_BYTES = 200 * 1024 * 1024;

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

function compactIds(ids: (number | null | undefined)[]): number[] {
  return ids.filter((id): id is number => id != null);
}

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
    revision: row.revision,
    motivo_rechazo: row.motivoRechazo,
    motivo_rechazo_detalle: row.motivoRechazoDetalle,
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

  // Un papel de venta (pago, recibido, cotización) cuenta en el expediente
  // de UNA oportunidad: sin ella se quedaría suelto sin contar en ninguna.
  private async validarTipoDocumento(tipoDocumentoId: number, oportunidadId: number | null) {
    const [row] = await this.db.select({ id: catalogoTipoDocumento.id, alcance: catalogoTipoDocumento.alcance }).from(catalogoTipoDocumento).where(eq(catalogoTipoDocumento.id, tipoDocumentoId)).limit(1);
    if (!row) throw new HttpError(404, "Tipo de documento no encontrado");
    if (row.alcance === "venta" && !oportunidadId) throw new HttpError(400, "Este papel es de una venta: elige la oportunidad", CODIGO_OPORTUNIDAD_REQUERIDA);
  }

  // A diferencia de catalogos() en OportunidadesService (donde el resto de
  // la API referencia la etapa por clave, nunca por id), aquí se expone
  // también el id: subirDocumentoSchema/nuevaVersionDocumentoSchema piden
  // tipoDocumentoId numérico, mismo patrón que empresaId/oportunidadId/
  // contactoId en ese mismo body -- así que el cliente necesita el id, no
  // solo la clave, para poder enviarlo de vuelta.
  async catalogos() {
    const tiposDocumento = await this.db
      .select({ id: catalogoTipoDocumento.id, clave: catalogoTipoDocumento.clave, nombre: catalogoTipoDocumento.nombre, obligatorio: catalogoTipoDocumento.obligatorio, alcance: catalogoTipoDocumento.alcance, solo_con_factura: catalogoTipoDocumento.soloConFactura })
      .from(catalogoTipoDocumento)
      .orderBy(catalogoTipoDocumento.nombre);
    return { tipos_documento: tiposDocumento, motivos_rechazo: MOTIVOS_RECHAZO_DOCUMENTO };
  }

  // Qué papel es obligatorio en el expediente (Fabián, 12-oct-2026): se
  // cambia desde el CRM, sin código, si Carlos pide otra lista. Solo
  // administrador (DocumentosController); auditado como configuración.
  async cambiarObligatorio(user: CurrentUser, tipoId: number, input: CambiarObligatorioInput) {
    const [tipo] = await this.db.select().from(catalogoTipoDocumento).where(eq(catalogoTipoDocumento.id, tipoId)).limit(1);
    if (!tipo) throw new HttpError(404, "Tipo de documento no encontrado");
    await this.db.transaction(async (tx) => {
      await tx.update(catalogoTipoDocumento).set({ obligatorio: input.obligatorio }).where(eq(catalogoTipoDocumento.id, tipoId));
      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "catalogo_tipo_documento",
        entidadId: tipoId,
        accion: "cambiar_obligatorio",
        antes: { obligatorio: tipo.obligatorio },
        despues: { obligatorio: input.obligatorio }
      });
    });
    return { id: tipo.id, clave: tipo.clave, nombre: tipo.nombre, obligatorio: input.obligatorio };
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
    // get()/abrirDescarga()/nuevaVersion()/cambiarEstado()/revisar()/
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
    // El tipo declarado lo escribe quien sube; se revisa contra el contenido
    // (ver tipo-de-archivo.ts, C5 del plan de fixes).
    if (!contenidoEsDelTipo(archivo.mimetype as (typeof TIPOS_MIME_PERMITIDOS)[number], archivo.buffer)) {
      throw new HttpError(400, "El contenido del archivo no corresponde a su tipo; sube el archivo original (PDF, DOCX, XLSX, PNG o JPG)");
    }
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
      input.tipoDocumentoId ? this.validarTipoDocumento(input.tipoDocumentoId, input.oportunidadId ?? null) : Promise.resolve()
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

  // Filtros de la bandeja, compartidos por list() y el lote zip. La consulta
  // debe tener el join a empresas.
  private condicionesBandeja(user: CurrentUser, query: Omit<ListDocumentosQuery, "page" | "limit">) {
    return compactConditions([
      query.empresaId ? eq(documentos.empresaId, query.empresaId) : undefined,
      // Sin empresaId, el mismo alcance que validarEmpresaScoped aplicado a
      // todas las filas: empresa activa y, para un agente, suya.
      eq(empresas.activo, true),
      user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined,
      eq(documentos.activo, true),
      query.estado ? eq(documentos.estado, query.estado) : undefined,
      query.revisado === true ? isNotNull(documentos.revisadoEn) : query.revisado === false ? isNull(documentos.revisadoEn) : undefined,
      query.revision ? eq(documentos.revision, query.revision) : undefined,
      query.tipoDocumentoId ? eq(documentos.tipoDocumentoId, query.tipoDocumentoId) : undefined,
      query.q ? or(like(documentos.nombreOriginal, patronLike(query.q)), like(empresas.nombreLegal, patronLike(query.q)), like(empresas.nombreComercial, patronLike(query.q))) : undefined,
      // Solo la versión vigente de cada cadena por default, igual criterio
      // que cotizaciones: una versión obsoleta solo aparece explícitamente
      // en GET /documentos/:id/versiones.
      ne(documentos.estado, "obsoleto"),
      query.oportunidadId ? eq(documentos.oportunidadId, query.oportunidadId) : undefined,
      query.contactoId ? eq(documentos.contactoId, query.contactoId) : undefined
    ]);
  }

  async list(user: CurrentUser, query: ListDocumentosQuery) {
    if (query.empresaId) await this.validarEmpresaScoped(user, query.empresaId);
    const offset = (query.page - 1) * query.limit;
    const revisor = alias(usuarios, "revisor");

    // tipo_nombre y revisado_por_nombre: la bandeja dice "Acta constitutiva"
    // y "Aprobado · Fabián, 3 oct" sin pedir el catálogo ni los usuarios.
    const rows = await this.db
      .select({
        documento: documentos,
        empresaNombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
        tipoNombre: catalogoTipoDocumento.nombre,
        revisadoPorNombre: revisor.nombre
      })
      .from(documentos)
      .innerJoin(empresas, eq(empresas.id, documentos.empresaId))
      .leftJoin(catalogoTipoDocumento, eq(catalogoTipoDocumento.id, documentos.tipoDocumentoId))
      .leftJoin(revisor, eq(revisor.id, documentos.revisadoPor))
      .where(and(...this.condicionesBandeja(user, query)))
      .orderBy(desc(documentos.actualizadoEn), desc(documentos.id))
      .limit(query.limit)
      .offset(offset);

    return {
      page: query.page,
      limit: query.limit,
      data: rows.map((r) => ({ ...toRow(r.documento), empresa_nombre: r.empresaNombre, tipo_nombre: r.tipoNombre, revisado_por_nombre: r.revisadoPorNombre }))
    };
  }

  // Contadores de la bandeja (12-oct-2026). Por revisar / aprobados /
  // rechazados: versiones vigentes. Expedientes incompletos (16-oct-2026):
  // ventas ganadas a las que les falta aprobar algún papel obligatorio, con
  // la misma regla del expediente (./expediente.ts). Una abierta no cuenta:
  // el expediente se exige al ganarla. Mismo alcance que la lista: un
  // agente, sus empresas.
  async conteos(user: CurrentUser) {
    const deAgente = user.rol === "agente" ? sql`AND e.propietario_id = ${user.id}` : sql``;
    const [[revisiones], empresasConGanadas] = await Promise.all([
      this.db.execute(sql`
        SELECT
          COALESCE(SUM(d.revision = 'por_revisar'), 0) AS por_revisar,
          COALESCE(SUM(d.revision = 'aprobado'), 0) AS aprobados,
          COALESCE(SUM(d.revision = 'rechazado'), 0) AS rechazados
        FROM documentos d JOIN empresas e ON e.id = d.empresa_id
        WHERE d.activo AND d.estado = 'vigente' AND e.activo ${deAgente}`),
      this.db
        .selectDistinct({ id: oportunidades.empresaId })
        .from(oportunidades)
        .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
        .innerJoin(empresas, eq(empresas.id, oportunidades.empresaId))
        .where(and(
          eq(oportunidades.cerrada, true),
          eq(catalogoEtapaEmbudo.esGanada, true),
          eq(empresas.activo, true),
          user.rol === "agente" ? eq(empresas.propietarioId, user.id) : undefined
        ))
    ]);
    const ganadas = await this.ventasConExpediente(empresasConGanadas.map((e) => e.id), { soloGanadas: true });
    const r = (revisiones as unknown as Record<string, unknown>[])[0] ?? {};
    return {
      por_revisar: Number(r.por_revisar ?? 0),
      aprobados: Number(r.aprobados ?? 0),
      rechazados: Number(r.rechazados ?? 0),
      expedientes_incompletos: ganadas.filter((v) => !v.completo).length
    };
  }

  // Expediente de un cliente (punto 49), por venta desde el 16-oct-2026:
  // cada oportunidad abierta o ganada (las perdidas no) con sus papeles
  // obligatorios y el estado de cada uno -- falta, por revisar, aprobado o
  // rechazado. Las ganadas primero. Un agente ve el de sus empresas, como
  // los documentos.
  async expediente(user: CurrentUser, empresaId: number) {
    await this.validarEmpresaScoped(user, empresaId);
    const ventas = await this.ventasConExpediente([empresaId], { soloGanadas: false });
    return { empresa_id: empresaId, ventas };
  }

  // Lo que necesita la regla del expediente (evaluarVenta) para estas
  // empresas, en cuatro consultas sin importar cuántas ventas sean.
  private async ventasConExpediente(empresaIds: number[], opciones: { soloGanadas: boolean }) {
    if (empresaIds.length === 0) return [];
    const [filas, tipos, firmada, docs] = await Promise.all([
      this.db
        .select({ id: oportunidades.id, empresaId: oportunidades.empresaId, titulo: oportunidades.titulo, llevaFactura: oportunidades.llevaFactura, cerrada: oportunidades.cerrada, esGanada: catalogoEtapaEmbudo.esGanada })
        .from(oportunidades)
        .innerJoin(catalogoEtapaEmbudo, eq(catalogoEtapaEmbudo.id, oportunidades.etapaId))
        .where(and(
          inArray(oportunidades.empresaId, empresaIds),
          opciones.soloGanadas
            ? and(eq(oportunidades.cerrada, true), eq(catalogoEtapaEmbudo.esGanada, true))
            : or(eq(oportunidades.cerrada, false), eq(catalogoEtapaEmbudo.esGanada, true))
        ))
        .orderBy(desc(oportunidades.cerrada), desc(oportunidades.creadoEn), desc(oportunidades.id)),
      this.db
        .select({ id: catalogoTipoDocumento.id, clave: catalogoTipoDocumento.clave, nombre: catalogoTipoDocumento.nombre, alcance: catalogoTipoDocumento.alcance, soloConFactura: catalogoTipoDocumento.soloConFactura })
        .from(catalogoTipoDocumento)
        .where(eq(catalogoTipoDocumento.obligatorio, true)),
      this.db.select({ id: catalogoTipoDocumento.id }).from(catalogoTipoDocumento).where(eq(catalogoTipoDocumento.clave, CLAVE_COTIZACION_FIRMADA)).limit(1),
      this.db
        .select({
          id: documentos.id,
          empresaId: documentos.empresaId,
          oportunidadId: documentos.oportunidadId,
          tipoDocumentoId: documentos.tipoDocumentoId,
          revision: documentos.revision,
          nombreOriginal: documentos.nombreOriginal,
          version: documentos.version,
          creadoEn: documentos.creadoEn,
          revisadoEn: documentos.revisadoEn,
          motivoRechazo: documentos.motivoRechazo,
          motivoRechazoDetalle: documentos.motivoRechazoDetalle
        })
        .from(documentos)
        .where(and(inArray(documentos.empresaId, empresaIds), eq(documentos.activo, true), eq(documentos.estado, "vigente")))
        .orderBy(desc(documentos.creadoEn), desc(documentos.id))
    ]);
    if (filas.length === 0) return [];
    const aceptadas = await this.db
      .select({ id: cotizaciones.id, version: cotizaciones.version, oportunidadId: cotizaciones.oportunidadId })
      .from(cotizaciones)
      .where(and(inArray(cotizaciones.oportunidadId, filas.map((f) => f.id)), eq(cotizaciones.estado, "aceptada")))
      .orderBy(desc(cotizaciones.id));

    // Las ganadas primero (cerrada DESC ya las junta con las perdidas, que
    // aquí no llegan: solo quedan abiertas y ganadas).
    return filas.map((f) => {
      const aceptada = aceptadas.find((c) => c.oportunidadId === f.id);
      const docsEmpresa: DocumentoDeExpediente[] = docs.filter((d) => d.empresaId === f.empresaId);
      return evaluarVenta(
        { id: f.id, titulo: f.titulo, ganada: f.cerrada && f.esGanada, llevaFactura: f.llevaFactura },
        tipos,
        docsEmpresa,
        aceptada ? { id: aceptada.id, version: aceptada.version } : undefined,
        firmada[0]?.id
      );
    });
  }

  // Descargar lote (punto 48): qué entra en el zip, con los mismos filtros
  // que la bandeja y solo versiones vigentes. Revisa el tope ANTES de abrir
  // nada y deja UNA fila de auditoría antes de empezar a mandar (si la
  // descarga se corta a medias, igual quedó registrado quién pidió qué).
  async prepararLote(user: CurrentUser, query: LoteDocumentosQuery) {
    if (query.empresaId) await this.validarEmpresaScoped(user, query.empresaId);
    const condiciones = and(...this.condicionesBandeja(user, { ...query, estado: "vigente" }));
    const [total] = await this.db
      .select({ cantidad: sql<number>`COUNT(*)`, bytes: sql<number>`COALESCE(SUM(${documentos.tamanoBytes}), 0)` })
      .from(documentos)
      .innerJoin(empresas, eq(empresas.id, documentos.empresaId))
      .where(condiciones);
    const cantidad = Number(total?.cantidad ?? 0);
    const bytes = Number(total?.bytes ?? 0);
    if (cantidad === 0) throw new HttpError(404, "No hay documentos con esos filtros");
    if (cantidad > LOTE_MAX_ARCHIVOS || bytes > LOTE_MAX_BYTES) {
      throw new HttpError(413, `El lote tiene ${cantidad} documentos (${Math.ceil(bytes / 1024 / 1024)} MB); el máximo es ${LOTE_MAX_ARCHIVOS} documentos o ${LOTE_MAX_BYTES / 1024 / 1024} MB. Filtra más.`, CODIGO_LOTE_DEMASIADO_GRANDE);
    }

    const filas = await this.db
      .select({ id: documentos.id, nombreOriginal: documentos.nombreOriginal, mimeType: documentos.mimeType, storageKey: documentos.storageKey, empresaNombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})` })
      .from(documentos)
      .innerJoin(empresas, eq(empresas.id, documentos.empresaId))
      .where(condiciones)
      .orderBy(empresas.nombreLegal, documentos.nombreOriginal, documentos.id);

    await this.db.insert(auditoria).values({
      usuarioId: user.id,
      entidad: "documento",
      entidadId: 0,
      accion: "descargar_lote",
      despues: { documento_ids: filas.map((f) => f.id), cantidad, bytes, filtros: query }
    });

    // Ruta dentro del zip: <empresa>/<archivo>, sin repetir nombres.
    const usadas = new Set<string>();
    const archivos = filas.map((f) => {
      const carpeta = f.empresaNombre.replace(/[\\/:*?"<>|]/g, "_").trim() || `empresa-${f.id}`;
      const nombre = nombreDeDescarga(f.nombreOriginal, f.mimeType).replace(/[\\/]/g, "_");
      let ruta = `${carpeta}/${nombre}`;
      for (let n = 2; usadas.has(ruta.toLowerCase()); n++) {
        const punto = nombre.lastIndexOf(".");
        ruta = punto > 0 ? `${carpeta}/${nombre.slice(0, punto)} (${n})${nombre.slice(punto)}` : `${carpeta}/${nombre} (${n})`;
      }
      usadas.add(ruta.toLowerCase());
      return { ruta, storageKey: f.storageKey };
    });
    return archivos;
  }

  // Abre un archivo del storage para el zip (uno a la vez, en orden).
  abrirArchivoDeLote(storageKey: string) {
    return this.storageService.leer(storageKey);
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

  // "Cada carga, descarga... queda auditado" (PLAN_CRM_DEFINITIVO.md #8).
  // Abre el archivo para que DocumentosController lo mande en la respuesta
  // (B6 del plan de fixes, 2-oct-2026). Se audita DESPUÉS de abrirlo: si el
  // archivo ya no está en storage, leer() lanza 404 y no queda registrada
  // una descarga que no hubo.
  // modo "ver" (vista previa, 12-oct-2026): solo PDF e imágenes, y se audita
  // como "ver" -- aparte de "descargar", para que el Registro de cambios no
  // cuente cada vistazo como una descarga.
  async abrirDescarga(user: CurrentUser, id: number, modo: ModoDescarga = "descargar") {
    const documento = await this.obtenerScoped(user, id);
    if (modo === "ver" && !MIME_CON_VISTA_PREVIA.includes(documento.mimeType)) {
      throw new HttpError(415, "Este tipo de archivo no tiene vista previa; descárgalo", CODIGO_VISTA_PREVIA_NO_DISPONIBLE);
    }
    const archivo = await this.storageService.leer(documento.storageKey);

    try {
      await this.db.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: id,
        accion: modo === "ver" ? "ver" : "descargar",
        despues: { version: documento.version }
      });
    } catch (error) {
      // Sin auditoría no hay descarga; se cierra el archivo ya abierto.
      archivo.stream.destroy();
      throw error;
    }

    return { ...archivo, nombreArchivo: nombreDeDescarga(documento.nombreOriginal, documento.mimeType), mimeType: documento.mimeType };
  }

  async nuevaVersion(user: CurrentUser, id: number, input: NuevaVersionDocumentoInput, archivo: ArchivoSubido | undefined) {
    this.validarArchivo(archivo);
    const actual = await this.obtenerScoped(user, id);
    if (actual.estado === "obsoleto") throw new HttpError(409, "No se puede versionar un documento ya obsoleto");
    if (input.tipoDocumentoId) await this.validarTipoDocumento(input.tipoDocumentoId, actual.oportunidadId);

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

      // La versión nueva empieza en por_revisar (default de la columna); si la
      // anterior estaba rechazada, su tarea de corrección ya se cumplió.
      await this.terminarTareasDeCorreccion(tx, actual.id, "cerrada", `Se subió la versión ${nuevaVersionNum}`);

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

      if (input.estado === "archivado") await this.terminarTareasDeCorreccion(tx, id, "cancelada", "El documento se archivó");
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
  // El botón viejo "Revisado" del front publicado: desde 029 equivale a
  // aprobar. Lo pueden usar los agentes, como antes, hasta que salga el front
  // nuevo (entonces se limita a admin/supervisor o se quita).
  async revisar(user: CurrentUser, id: number, input: RevisarDocumentoInput) {
    await this.obtenerScoped(user, id);
    await this.aplicarRevision(user, id, "revisar", { revision: "aprobado", motivoRechazo: null, motivoRechazoDetalle: null }, { comentario: input.comentario ?? null });
    return this.get(user, id);
  }

  // Aprobar / rechazar (punto 47): solo administrador y supervisor
  // (DocumentosController). Se puede cambiar de opinión: aprobar uno
  // rechazado cancela su tarea de corrección.
  async aprobar(user: CurrentUser, id: number) {
    await this.obtenerScoped(user, id);
    await this.aplicarRevision(user, id, "aprobar", { revision: "aprobado", motivoRechazo: null, motivoRechazoDetalle: null });
    return this.get(user, id);
  }

  async rechazar(user: CurrentUser, id: number, input: RechazarDocumentoInput) {
    await this.obtenerScoped(user, id);
    await this.aplicarRevision(user, id, "rechazar", { revision: "rechazado", motivoRechazo: input.motivoRechazo, motivoRechazoDetalle: input.motivoRechazoDetalle });
    return this.get(user, id);
  }

  private async aplicarRevision(
    user: CurrentUser,
    id: number,
    accion: "revisar" | "aprobar" | "rechazar",
    cambio: Pick<typeof documentos.$inferInsert, "revision" | "motivoRechazo" | "motivoRechazoDetalle">,
    extraAuditoria: Record<string, unknown> = {}
  ) {
    await this.db.transaction(async (tx) => {
      // FOR UPDATE: el "antes" de la auditoría y la tarea salen de lo último
      // confirmado.
      const [antes] = await tx.select().from(documentos).where(eq(documentos.id, id)).limit(1).for("update");
      // Solo la versión vigente (C5 del plan de fixes, 2-oct-2026): revisar
      // una obsoleta o archivada dejaba la vigente sin revisar y la alerta de
      // pendientes seguía sonando. La condición va en el UPDATE para que un
      // cambio de estado al mismo tiempo no se cuele. sql`CURRENT_TIMESTAMP`
      // (hora de MySQL), no `new Date()` en Node: evita el desfase de zona.
      const [result] = await tx.update(documentos)
        .set({ ...cambio, revisadoPor: user.id, revisadoEn: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(documentos.id, id), eq(documentos.estado, "vigente")));
      if (!antes || result.affectedRows === 0) throw new HttpError(409, "Solo se revisa la versión vigente del documento", CODIGO_DOCUMENTO_NO_VIGENTE);

      await tx.insert(auditoria).values({
        usuarioId: user.id,
        entidad: "documento",
        entidadId: id,
        accion,
        antes: { revision: antes.revision, motivo_rechazo: antes.motivoRechazo, motivo_rechazo_detalle: antes.motivoRechazoDetalle },
        despues: { revision: cambio.revision, motivo_rechazo: cambio.motivoRechazo ?? null, motivo_rechazo_detalle: cambio.motivoRechazoDetalle ?? null, ...extraAuditoria }
      });

      if (cambio.revision === "rechazado") {
        await this.tareaDeCorreccion(tx, user, antes, cambio.motivoRechazo!, cambio.motivoRechazoDetalle!);
      } else {
        await this.terminarTareasDeCorreccion(tx, id, "cancelada", "El documento se aprobó");
      }
    });
  }

  // "Corregir documento" (Fabián, 12-oct-2026): al rechazar, quien lo subió
  // recibe una tarea con el motivo y la explicación, y le sale en Mi día. Si
  // ya no está activo, va al dueño de la empresa; si tampoco hay, a la
  // bandeja sin asignar. Rechazarlo otra vez no duplica la tarea: solo pone
  // el motivo nuevo.
  private async tareaDeCorreccion(tx: DrizzleTx, user: CurrentUser, documento: typeof documentos.$inferSelect, motivo: keyof typeof NOMBRE_MOTIVO_RECHAZO_DOCUMENTO, detalle: string) {
    const [contexto] = await tx
      .select({
        empresaNombre: sql<string>`COALESCE(${empresas.nombreComercial}, ${empresas.nombreLegal})`,
        propietarioId: empresas.propietarioId,
        tipoNombre: catalogoTipoDocumento.nombre
      })
      .from(empresas)
      .leftJoin(catalogoTipoDocumento, eq(catalogoTipoDocumento.id, documento.tipoDocumentoId ?? 0))
      .where(eq(empresas.id, documento.empresaId))
      .limit(1);
    const descripcion = [
      `${contexto?.empresaNombre ?? "Empresa"} · ${contexto?.tipoNombre ?? "Documento sin tipo"} · versión ${documento.version}`,
      `Motivo: ${NOMBRE_MOTIVO_RECHAZO_DOCUMENTO[motivo]}`,
      detalle,
      "Sube la versión corregida desde el documento; esta tarea se cierra sola."
    ].join("\n");

    // Aviso con correo a quien le toca corregirlo (etapa 2 de las mejoras,
    // 19-oct-2026), también si lo rechazan otra vez con otro motivo.
    const avisar = (tareaId: number, responsableId: number | null) => notificar(tx, [responsableId], {
      tipo: "documento_rechazado",
      titulo: `Rechazaron un documento: ${documento.nombreOriginal}`,
      cuerpo: [`${contexto?.empresaNombre ?? "Empresa"} · Motivo: ${NOMBRE_MOTIVO_RECHAZO_DOCUMENTO[motivo]}`, detalle].join("\n"),
      enlace: enlaceTarea(tareaId),
      entidad: "tarea",
      entidadId: tareaId,
      conCorreo: true
    }, user.id);

    const [abierta] = await tx.select({ id: tareas.id, responsableId: tareas.responsableId }).from(tareas)
      .where(and(eq(tareas.documentoId, documento.id), inArray(tareas.estado, ["pendiente", "en_progreso"]))).limit(1);
    if (abierta) {
      await tx.update(tareas).set({ descripcion }).where(eq(tareas.id, abierta.id));
      await avisar(abierta.id, abierta.responsableId);
      return;
    }

    const activos = await tx.select({ id: usuarios.id }).from(usuarios)
      .where(and(inArray(usuarios.id, compactIds([documento.subidoPor, contexto?.propietarioId])), eq(usuarios.activo, true)));
    const activo = (uid: number | null | undefined) => uid != null && activos.some((u) => u.id === uid);
    const responsableId = activo(documento.subidoPor) ? documento.subidoPor : activo(contexto?.propietarioId) ? contexto!.propietarioId : null;

    const [nueva] = await tx.insert(tareas).values({
      tipo: "revision_documento",
      titulo: `Corregir documento: ${documento.nombreOriginal}`.slice(0, 255),
      descripcion,
      responsableId,
      empresaId: documento.empresaId,
      contactoId: documento.contactoId,
      documentoId: documento.id,
      fechaLimite: finSiguienteDiaHabilMx(new Date()),
      creadaPor: user.id
    });
    await avisar(nueva.insertId, responsableId);
  }

  // Cierra (versión nueva) o cancela (aprobado, archivado, borrado) la tarea
  // "Corregir documento" que siga abierta.
  private async terminarTareasDeCorreccion(tx: DrizzleTx, documentoId: number, estado: "cerrada" | "cancelada", resultado: string) {
    await tx.update(tareas)
      .set({ estado, resultado, cerradaEn: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(tareas.documentoId, documentoId), inArray(tareas.estado, ["pendiente", "en_progreso"])));
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
  // Lo dispara n8n cada día (POST /automatizacion/jobs/..., B5 del plan de
  // fixes, 2-oct-2026): con @Interval(24h) nunca corría en Cloud Run.
  async alertarDocumentosPendientes() {
    const candidatos = await this.db
      .select({ id: documentos.id, empresaId: documentos.empresaId, nombreOriginal: documentos.nombreOriginal, creadoEn: documentos.creadoEn })
      .from(documentos)
      .where(and(
        eq(documentos.estado, "vigente"),
        eq(documentos.activo, true),
        // Desde 029: lo que sigue por revisar (un rechazado ya se revisó;
        // queda en la tarea de corrección).
        eq(documentos.revision, "por_revisar"),
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

      await this.terminarTareasDeCorreccion(tx, id, "cancelada", "El documento se borró");
    });
  }
}
