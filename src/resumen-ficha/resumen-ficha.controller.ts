import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { ResumenFichaService } from "./resumen-ficha.service.js";

const empresaIdSchema = z.coerce.number().int().positive();

// Resumen con IA en la ficha del cliente (etapa 4). Lo que ve cada rol lo
// aplica el servicio, con las mismas reglas de la ficha.
@Controller("api/v1/empresas")
@UseGuards(SessionAuthGuard, RolesGuard)
export class ResumenFichaController {
  constructor(private readonly service: ResumenFichaService) {}

  @Get(":id/resumen-ia")
  @Roles("administrador", "supervisor", "agente")
  estado(@Param("id") id: string, @CurrentUser() user: CurrentUserType) {
    return this.service.estado(user, empresaIdSchema.parse(id));
  }

  @Post(":id/resumen-ia")
  @Roles("administrador", "supervisor", "agente")
  generar(@Param("id") id: string, @CurrentUser() user: CurrentUserType) {
    return this.service.generar(user, empresaIdSchema.parse(id));
  }
}
