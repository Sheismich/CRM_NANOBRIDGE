import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { TareasService } from "./tareas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { cerrarTareaSchema, crearTareaSchema, listTareasQuerySchema } from "./dto/tarea.schema.js";

const idParamSchema = z.coerce.number().int().positive();

@Controller("api/v1/tareas")
@UseGuards(SessionAuthGuard, RolesGuard)
export class TareasController {
  constructor(private readonly tareasService: TareasService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const { page, limit, ...filters } = listTareasQuerySchema.parse(query);
    return this.tareasService.list(user, filters, page, limit);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  async create(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = crearTareaSchema.parse(body);
    const id = await this.tareasService.create(user, input);
    return { id };
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.tareasService.get(user, id);
  }

  @Patch(":id/cerrar")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  async cerrar(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const { resultado } = cerrarTareaSchema.parse(body);
    await this.tareasService.cerrar(user, id, resultado);
    return this.tareasService.get(user, id);
  }
}
