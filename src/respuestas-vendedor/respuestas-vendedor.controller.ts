import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { RespuestasVendedorService } from "./respuestas-vendedor.service.js";
import { contestarInputSchema, respuestaIdSchema } from "./dto/respuestas-vendedor.schema.js";

// Responder al prospecto desde el CRM (etapa 3). Los permisos finos (un
// agente solo lo suyo) van en el servicio.
@Controller("api/v1/respuestas")
@UseGuards(SessionAuthGuard, RolesGuard)
export class RespuestasVendedorController {
  constructor(private readonly service: RespuestasVendedorService) {}

  @Get(":id/contestar")
  @Roles("administrador", "supervisor", "agente")
  contexto(@Param("id") id: string, @CurrentUser() user: CurrentUserType) {
    return this.service.contexto(user, respuestaIdSchema.parse(id));
  }

  @Post(":id/borrador-ia")
  @Roles("administrador", "supervisor", "agente")
  borrador(@Param("id") id: string, @CurrentUser() user: CurrentUserType) {
    return this.service.borrador(user, respuestaIdSchema.parse(id));
  }

  @Post(":id/contestar")
  @Roles("administrador", "supervisor", "agente")
  contestar(@Param("id") id: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.service.contestar(user, respuestaIdSchema.parse(id), contestarInputSchema.parse(body));
  }
}
