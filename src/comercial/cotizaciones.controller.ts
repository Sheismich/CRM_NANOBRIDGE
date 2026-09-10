import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { CotizacionesService } from "./cotizaciones.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { cambiarEstadoCotizacionSchema, crearCotizacionSchema, datosCotizacionSchema, listCotizacionesQuerySchema } from "./dto/cotizacion.schema.js";

const idParamSchema = z.coerce.number().int().positive();

@Controller("api/v1/cotizaciones")
@UseGuards(SessionAuthGuard, RolesGuard)
export class CotizacionesController {
  constructor(private readonly cotizacionesService: CotizacionesService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = listCotizacionesQuerySchema.parse(query);
    return this.cotizacionesService.list(user, input);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  create(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = crearCotizacionSchema.parse(body);
    return this.cotizacionesService.crear(user, input);
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.cotizacionesService.get(user, id);
  }

  @Post(":id/version")
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  nuevaVersion(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = datosCotizacionSchema.parse(body);
    return this.cotizacionesService.nuevaVersion(user, id, input);
  }

  @Patch(":id/estado")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  cambiarEstado(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = cambiarEstadoCotizacionSchema.parse(body);
    return this.cotizacionesService.cambiarEstado(user, id, input);
  }
}
