import { Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { OutboxService } from "./outbox.service.js";
import { OutboxDispatcherService } from "./outbox-dispatcher.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { listEventosQuerySchema } from "./dto/eventos.schema.js";

const idParamSchema = z.coerce.number().int().positive();

// Solo administrador: la pantalla de eventos pendientes es una herramienta
// operativa (visibilidad y reintento del patrón outbox), no algo que vean
// agentes o supervisores.
@Controller("api/v1/eventos-pendientes")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador")
export class EventosPendientesController {
  constructor(
    private readonly outboxService: OutboxService,
    private readonly dispatcherService: OutboxDispatcherService
  ) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const { page, limit, estado } = listEventosQuerySchema.parse(query);
    return this.outboxService.list(estado, page, limit);
  }

  @Post(":id/reintentar")
  @HttpCode(204)
  async retry(@Param("id") idParam: string, @CurrentUser() actor: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    await this.outboxService.retry(actor, id);
  }

  @Post("despachar")
  @HttpCode(200)
  async dispatch() {
    const processed = await this.dispatcherService.dispatchPending();
    return { procesados: processed ?? 0 };
  }
}
