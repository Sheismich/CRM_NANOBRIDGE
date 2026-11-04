import { Body, Controller, Get, HttpCode, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ProcesosFallidosService } from "./procesos-fallidos.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { actualizarEstadoProcesoFallidoSchema, listProcesosFallidosQuerySchema } from "./dto/procesos-fallidos.schema.js";

const idParamSchema = z.coerce.number().int().positive();

// Herramienta operativa: solo administrador.
@Controller("api/v1/procesos-fallidos")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador")
export class ProcesosFallidosController {
  constructor(private readonly procesosFallidosService: ProcesosFallidosService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const { page, limit, estado, tipo } = listProcesosFallidosQuerySchema.parse(query);
    return this.procesosFallidosService.listar(estado, tipo, page, limit);
  }

  @Patch(":id/estado")
  @HttpCode(200)
  async actualizarEstado(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() actor: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const { estado } = actualizarEstadoProcesoFallidoSchema.parse(body);
    await this.procesosFallidosService.actualizarEstado(actor, id, estado);
    return { id, estado };
  }
}
