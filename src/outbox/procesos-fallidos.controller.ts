import { Body, Controller, Get, HttpCode, Param, Patch, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { OutboxService } from "./outbox.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { actualizarEstadoProcesoFallidoSchema, listProcesosFallidosQuerySchema } from "./dto/procesos-fallidos.schema.js";

const idParamSchema = z.coerce.number().int().positive();

// Mismo criterio que EventosPendientesController: herramienta operativa,
// solo administrador.
@Controller("api/v1/procesos-fallidos")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador")
export class ProcesosFallidosController {
  constructor(private readonly outboxService: OutboxService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const { page, limit, estado, tipo } = listProcesosFallidosQuerySchema.parse(query);
    return this.outboxService.listProcesosFallidos(estado, tipo, page, limit);
  }

  @Patch(":id/estado")
  @HttpCode(200)
  async actualizarEstado(@Param("id") idParam: string, @Body() body: unknown) {
    const id = idParamSchema.parse(idParam);
    const { estado } = actualizarEstadoProcesoFallidoSchema.parse(body);
    await this.outboxService.actualizarEstadoProcesoFallido(id, estado);
    return { id, estado };
  }
}
