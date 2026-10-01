import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CampanasService } from "./campanas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { crearCampanaSchema, editarCampanaSchema, listCampanasQuerySchema } from "./dto/campana.schema.js";

const idParamSchema = z.coerce.number().int().positive();

// Campañas (1-oct-2026). Crear y cambiar: administrador y supervisor (una
// campaña decide a quién se le escribe); ver: también agentes (decisión de
// Fabián, 1-oct-2026).
@Controller("api/v1/campanas")
@UseGuards(SessionAuthGuard, RolesGuard)
export class CampanasController {
  constructor(private readonly campanasService: CampanasService) {}

  @Get()
  @Roles("administrador", "supervisor", "agente")
  list(@Query() query: Record<string, unknown>) {
    return this.campanasService.list(listCampanasQuerySchema.parse(query));
  }

  @Get(":id")
  @Roles("administrador", "supervisor", "agente")
  get(@Param("id") idParam: string) {
    return this.campanasService.get(idParamSchema.parse(idParam));
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor")
  create(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.campanasService.create(user, crearCampanaSchema.parse(body));
  }

  @Patch(":id")
  @Roles("administrador", "supervisor")
  update(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.campanasService.update(user, idParamSchema.parse(idParam), editarCampanaSchema.parse(body));
  }

  @Post(":id/activar")
  @HttpCode(200)
  @Roles("administrador", "supervisor")
  activar(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    return this.campanasService.cambiarEstado(user, idParamSchema.parse(idParam), "activar");
  }

  @Post(":id/pausar")
  @HttpCode(200)
  @Roles("administrador", "supervisor")
  pausar(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    return this.campanasService.cambiarEstado(user, idParamSchema.parse(idParam), "pausar");
  }

  @Post(":id/finalizar")
  @HttpCode(200)
  @Roles("administrador", "supervisor")
  finalizar(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    return this.campanasService.cambiarEstado(user, idParamSchema.parse(idParam), "finalizar");
  }
}
