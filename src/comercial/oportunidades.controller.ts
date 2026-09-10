import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { OportunidadesService } from "./oportunidades.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { cambiarEtapaSchema, crearOportunidadSchema, listOportunidadesQuerySchema, reabrirOportunidadSchema } from "./dto/oportunidad.schema.js";

const idParamSchema = z.coerce.number().int().positive();

@Controller("api/v1/oportunidades")
@UseGuards(SessionAuthGuard, RolesGuard)
export class OportunidadesController {
  constructor(private readonly oportunidadesService: OportunidadesService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = listOportunidadesQuerySchema.parse(query);
    return this.oportunidadesService.list(user, input);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  async create(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = crearOportunidadSchema.parse(body);
    const id = await this.oportunidadesService.create(user, input);
    return { id };
  }

  // Ruta estática antes de ":id" — si no, Nest intentaría resolver
  // "catalogos" como el parámetro :id.
  @Get("catalogos")
  catalogos() {
    return this.oportunidadesService.catalogos();
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.oportunidadesService.get(user, id);
  }

  @Patch(":id/etapa")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  cambiarEtapa(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = cambiarEtapaSchema.parse(body);
    return this.oportunidadesService.cambiarEtapa(user, id, input);
  }

  @Patch(":id/reabrir")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  reabrir(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = reabrirOportunidadSchema.parse(body);
    return this.oportunidadesService.reabrir(user, id, input);
  }
}
