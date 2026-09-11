import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { z } from "zod";
import { DocumentosService } from "./documentos.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { env } from "../config/env.js";
import { cambiarEstadoDocumentoSchema, listDocumentosQuerySchema, nuevaVersionDocumentoSchema, revisarDocumentoSchema, subirDocumentoSchema } from "./dto/documento.schema.js";

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
  limits: { fileSize: env.STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024 }
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

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.documentosService.get(user, id);
  }

  @Get(":id/descarga")
  descarga(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.documentosService.obtenerUrlDescarga(user, id);
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

  @Patch(":id/revisar")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  revisar(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = revisarDocumentoSchema.parse(body);
    return this.documentosService.revisar(user, id, input);
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
