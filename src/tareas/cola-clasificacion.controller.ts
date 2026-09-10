import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { TareasService } from "./tareas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { clasificarTareaSchema } from "./dto/tarea.schema.js";

const idParamSchema = z.coerce.number().int().positive();
const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

// Cola de clasificación manual (PLAN_CRM_DEFINITIVO.md #5): tareas tipo
// 'clasificacion' pendientes. Resolverlas cierra la tarea y encola un evento
// outbox hacia n8n con el resultado.
@Controller("api/v1/cola-clasificacion")
@UseGuards(SessionAuthGuard, RolesGuard)
export class ColaClasificacionController {
  constructor(private readonly tareasService: TareasService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const { page, limit } = listQuerySchema.parse(query);
    return this.tareasService.listColaClasificacion(user, page, limit);
  }

  @Post(":id/clasificar")
  @HttpCode(200)
  @Roles("administrador", "supervisor", "agente")
  async clasificar(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = clasificarTareaSchema.parse(body);
    await this.tareasService.clasificar(user, id, input);
    return this.tareasService.get(user, id);
  }
}
