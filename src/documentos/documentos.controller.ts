import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { pipeline } from "node:stream/promises";
import { memoryStorage } from "multer";
import { z } from "zod";
import { DocumentosService } from "./documentos.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { env } from "../config/env.js";
import archiver from "archiver";
import { contentDispositionAdjunto, contentDispositionEnLinea } from "../shared/content-disposition.js";
import { fechaMx } from "../shared/dia-habil.js";
import { cambiarEstadoDocumentoSchema, cambiarObligatorioSchema, listDocumentosQuerySchema, loteDocumentosQuerySchema, modoDescargaSchema, nuevaVersionDocumentoSchema, rechazarDocumentoSchema, revisarDocumentoSchema, subirDocumentoSchema } from "./dto/documento.schema.js";

const idParamSchema = z.coerce.number().int().positive();

// memoryStorage(): el buffer completo queda en RAM (no en disco temporal),
// necesario para pasarlo tal cual a StorageService.subir() sin importar el
// driver. `limits.fileSize` SÍ se fija aquí (a diferencia de la versión
// anterior de este comentario): sin un tope a nivel de multer, un cliente
// podía mandar un cuerpo multipart de cientos de MB/GB y la petición
// completa se bufferizaba en RAM antes de que
// DocumentosService.validarArchivo() llegara a rechazarla -- múltiples
// subidas grandes concurrentes agotaban memoria del proceso (hallazgo de
// code review, 11-sep-2026). Cuando multer corta la subida por exceder el
// límite lanza PayloadTooLargeException, que HttpExceptionFilter
// (src/shared/http-exception.filter.ts) ahora traduce a 400 -- mismo
// contrato que validarArchivo() para el caso que sí llega a bufferizarse
// completo.
const uploadInterceptor = FileInterceptor("archivo", {
  storage: memoryStorage(),
  limits: { fileSize: env.STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024 },
  // multer decodifica los nombres de campo/archivo del multipart como
  // 'latin1' por default (busboy, del que depende) -- todo navegador
  // moderno manda el filename como bytes UTF-8 crudos en el header (no hay
  // un estándar real para esto), así que sin esto cualquier archivo con
  // acentos o "ñ" en el nombre ("Cotización firmada.pdf", nada raro en
  // este proyecto) se guardaba con nombre_original ya corrupto -- se
  // encontró al escribir 150-documentos-flujo.spec.ts (18-sep-2026): el
  // Content-Disposition de la descarga terminaba con bytes doblemente
  // codificados en vez del nombre real.
  defParamCharset: "utf8"
});

@Controller("api/v1/documentos")
@UseGuards(SessionAuthGuard, RolesGuard)
export class DocumentosController {
  constructor(private readonly documentosService: DocumentosService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = listDocumentosQuerySchema.parse(query);
    return this.documentosService.list(user, input);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  @UseInterceptors(uploadInterceptor)
  subir(@UploadedFile() archivo: Express.Multer.File | undefined, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = subirDocumentoSchema.parse(body);
    return this.documentosService.subir(user, input, archivo);
  }

  // Declarado ANTES de @Get(":id") -- si no, Nest intentaría resolver
  // "catalogos" como el parámetro :id (mismo cuidado que en
  // OportunidadesController).
  @Get("catalogos")
  catalogos() {
    return this.documentosService.catalogos();
  }

  // Qué papel es obligatorio en el expediente: solo administrador.
  @Patch("catalogos/tipos/:id")
  @HttpCode(200)
  @Roles("administrador")
  cambiarObligatorio(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.documentosService.cambiarObligatorio(user, id, cambiarObligatorioSchema.parse(body));
  }

  // Contadores y expediente (12-oct-2026); también antes de ":id".
  @Get("conteos")
  conteos(@CurrentUser() user: CurrentUserType) {
    return this.documentosService.conteos(user);
  }

  @Get("expediente/:empresaId")
  expediente(@Param("empresaId") idParam: string, @CurrentUser() user: CurrentUserType) {
    return this.documentosService.expediente(user, idParamSchema.parse(idParam));
  }

  // Descargar lote (punto 48): zip de lo filtrado, solo administrador y
  // supervisor (bajar actas e INEs de golpe es delicado). Va en STREAMING:
  // sin Content-Length, cada archivo se lee del storage y se escribe al zip
  // mientras sale, uno a la vez -- nunca se arma el zip completo en memoria
  // (Cloud Run corta las respuestas grandes que no van en flujo). store:
  // los PDF y JPG ya vienen comprimidos; comprimir otra vez solo gasta CPU.
  @Get("lote")
  @Roles("administrador", "supervisor")
  async lote(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType, @Res() response: Response) {
    const archivos = await this.documentosService.prepararLote(user, loteDocumentosQuerySchema.parse(query));
    response.status(200).set({
      "Content-Type": "application/zip",
      "Content-Disposition": contentDispositionAdjunto(`documentos-${fechaMx(new Date())}.zip`),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store"
    });
    const zip = archiver("zip", { store: true });
    zip.on("warning", (error) => console.warn("[documentos] lote:", error.message));
    zip.pipe(response);
    try {
      for (const archivo of archivos) {
        const { stream } = await this.documentosService.abrirArchivoDeLote(archivo.storageKey);
        // Espera a que este archivo termine de entrar al zip antes de abrir el
        // siguiente: un solo archivo abierto a la vez.
        await new Promise<void>((resolve, reject) => {
          stream.once("end", resolve).once("error", reject);
          zip.append(stream, { name: archivo.ruta });
        });
      }
      await zip.finalize();
    } catch (error) {
      // Las cabeceras ya salieron: igual que en la descarga suelta, solo se
      // puede cortar (el zip queda incompleto y el navegador lo marca).
      console.error("[documentos] lote interrumpido:", (error as Error).message);
      zip.abort();
      response.destroy();
    }
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.documentosService.get(user, id);
  }

  // La API manda el archivo ella misma, con la sesión del usuario (B6 del
  // plan de fixes, 2-oct-2026): no hay enlace que reenviar, cada descarga
  // pasa por el scoping y queda auditada. nosniff evita que el navegador
  // "adivine" otro tipo (p. ej. HTML dentro de un supuesto PDF) y no-store
  // que quede copia en caché de un equipo compartido.
  // ?modo=ver (vista previa, 12-oct-2026): inline, solo PDF e imágenes.
  // CSP sandbox: si alguien lograra colar un archivo con script, el navegador
  // lo abre sin permisos (sin scripts, sin la sesión del CRM).
  @Get(":id/descarga")
  async descarga(@Param("id") idParam: string, @Query("modo") modoParam: unknown, @CurrentUser() user: CurrentUserType, @Res() response: Response) {
    const id = idParamSchema.parse(idParam);
    const modo = modoDescargaSchema.parse(modoParam);
    const { stream, tamanoBytes, nombreArchivo, mimeType } = await this.documentosService.abrirDescarga(user, id, modo);
    response.status(200).set({
      "Content-Type": mimeType,
      "Content-Length": String(tamanoBytes),
      "Content-Disposition": modo === "ver" ? contentDispositionEnLinea(nombreArchivo) : contentDispositionAdjunto(nombreArchivo),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
      ...(modo === "ver" ? { "Content-Security-Policy": "sandbox" } : {})
    });
    try {
      await pipeline(stream, response);
    } catch (error) {
      // Las cabeceras ya salieron: no se puede responder un error. Pasa si
      // el usuario cancela la descarga o si storage falla a la mitad;
      // pipeline() ya cerró las dos puntas.
      console.error(`[documentos] descarga ${id} interrumpida:`, (error as Error).message);
    }
  }

  @Post(":id/version")
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  @UseInterceptors(uploadInterceptor)
  nuevaVersion(@Param("id") idParam: string, @UploadedFile() archivo: Express.Multer.File | undefined, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = nuevaVersionDocumentoSchema.parse(body);
    return this.documentosService.nuevaVersion(user, id, input, archivo);
  }

  @Patch(":id/estado")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  cambiarEstado(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = cambiarEstadoDocumentoSchema.parse(body);
    return this.documentosService.cambiarEstado(user, id, input);
  }

  // El botón viejo "Revisado" (front publicado): equivale a aprobar y lo
  // siguen usando los agentes. PENDIENTE: limitarlo a admin/supervisor (o
  // quitarlo) cuando salga el front nuevo.
  @Patch(":id/revisar")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  revisar(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = revisarDocumentoSchema.parse(body);
    return this.documentosService.revisar(user, id, input);
  }

  // Aprobar / rechazar (punto 47): solo administrador y supervisor, igual
  // que clasificar respuestas.
  @Patch(":id/aprobar")
  @HttpCode(200)
  @Roles("administrador", "supervisor")
  aprobar(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    return this.documentosService.aprobar(user, idParamSchema.parse(idParam));
  }

  @Patch(":id/rechazar")
  @HttpCode(200)
  @Roles("administrador", "supervisor")
  rechazar(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.documentosService.rechazar(user, id, rechazarDocumentoSchema.parse(body));
  }

  // Solo administrador/supervisor (no agente): retirar un documento del
  // expediente es más sensible que subirlo -- el plan no lo detalla, ver
  // comentario en DocumentosService.eliminar.
  @Delete(":id")
  @HttpCode(204)
  @Roles("administrador", "supervisor")
  async eliminar(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    await this.documentosService.eliminar(user, id);
  }
}
