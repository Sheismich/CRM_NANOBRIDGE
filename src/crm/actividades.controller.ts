import { Body, Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { ActividadesService } from "./actividades.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { crearActividadSchema, timelineQuerySchema } from "./dto/actividad.schema.js";

@Controller("api/v1/actividades")
@UseGuards(SessionAuthGuard, RolesGuard)
export class ActividadesController {
  constructor(private readonly actividadesService: ActividadesService) {}

  @Get()
  timeline(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = timelineQuerySchema.parse(query);
    return this.actividadesService.timeline(user, input);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  async crear(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = crearActividadSchema.parse(body);
    return this.actividadesService.crear(user, input);
  }
}
