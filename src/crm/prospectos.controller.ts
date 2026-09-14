import { Body, Controller, Get, HttpCode, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";
import { z } from "zod";
import { ProspectosService } from "./prospectos.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { importarCsvBodySchema, listBorradoresQuerySchema, listProspectosQuerySchema, prospectoInputSchema } from "./dto/prospecto.schema.js";

const idParamSchema = z.coerce.number().int().positive();
const confirmarBodySchema = z.object({ usarContactoExistente: z.boolean().default(false) });

// CSV en texto plano, no un archivo grande: 2 MB alcanza de sobra para
// miles de filas y evita el mismo riesgo de RAM que ya documenta
// DocumentosController para archivos binarios (limits.fileSize a nivel de
// multer, no solo validación después de bufferizar completo).
const uploadCsvInterceptor = FileInterceptor("archivo", {
  storage: memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }
});

// Prospectos (PLAN_CRM_DEFINITIVO.md #3, PLAN_API_DEFINITIVO.md grupo
// /prospectos): a diferencia de /api/v1/automatizacion/prospectos (n8n,
// X-API-Key, un registro confiable por evento), este controlador es
// para un usuario de sesión dando de alta prospectos a mano o por lote
// vía CSV -- todo pasa primero por borradores_captura para revisión
// humana antes de convertirse en empresa/contacto/prospecto real.
@Controller("api/v1/prospectos")
@UseGuards(SessionAuthGuard, RolesGuard)
export class ProspectosController {
  constructor(private readonly prospectosService: ProspectosService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = listProspectosQuerySchema.parse(query);
    return this.prospectosService.listProspectos(user, input);
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.prospectosService.getProspecto(user, id);
  }

  // Alta manual = lote de 1 fila; ver comentario en
  // ProspectosService.crearManual().
  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  crear(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = prospectoInputSchema.parse(body);
    return this.prospectosService.crearManual(user, input);
  }

  @Post("importaciones")
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  @UseInterceptors(uploadCsvInterceptor)
  importar(@UploadedFile() archivo: Express.Multer.File | undefined, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = importarCsvBodySchema.parse(body);
    return this.prospectosService.importarCsv(user, archivo, input.campanaId);
  }

  @Get("importaciones/:loteId")
  @Roles("administrador", "supervisor", "agente")
  listarLote(@Param("loteId") loteId: string, @Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = listBorradoresQuerySchema.parse(query);
    return this.prospectosService.listarBorradores(user, loteId, input);
  }

  @Post("importaciones/:loteId/filas/:id/confirmar")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  confirmar(@Param("loteId") loteId: string, @Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = confirmarBodySchema.parse(body ?? {});
    return this.prospectosService.confirmarFila(user, loteId, id, input.usarContactoExistente);
  }

  @Post("importaciones/:loteId/filas/:id/rechazar")
  @HttpCode(204)
  @Roles("administrador", "supervisor", "agente")
  async rechazar(@Param("loteId") loteId: string, @Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    await this.prospectosService.rechazarFila(user, loteId, id);
  }

  @Post("importaciones/:loteId/confirmar-todos")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  confirmarTodos(@Param("loteId") loteId: string, @CurrentUser() user: CurrentUserType) {
    return this.prospectosService.confirmarTodos(user, loteId);
  }
}
