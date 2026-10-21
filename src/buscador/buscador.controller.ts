import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { BuscadorService } from "./buscador.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { buscarQuerySchema } from "./dto/buscar.schema.js";

// Buscador general (Ctrl+K). Lo usan los tres roles; cada grupo aplica las
// mismas reglas que su lista, así que un agente solo encuentra lo suyo.
@Controller("api/v1/buscar")
@UseGuards(SessionAuthGuard)
export class BuscadorController {
  constructor(private readonly buscadorService: BuscadorService) {}

  @Get()
  buscar(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    return this.buscadorService.buscar(user, buscarQuerySchema.parse(query));
  }
}
