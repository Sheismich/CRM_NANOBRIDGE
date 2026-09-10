import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { EmpresasService } from "./empresas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { companyInputSchema, listQuerySchema } from "./dto/empresa.schema.js";

const idParamSchema = z.coerce.number().int().positive();

@Controller("api/v1/empresas")
@UseGuards(SessionAuthGuard, RolesGuard)
export class EmpresasController {
  constructor(private readonly empresasService: EmpresasService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const { page, limit } = listQuerySchema.parse(query);
    return this.empresasService.list(user, page, limit);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  async create(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const input = companyInputSchema.parse(body);
    const id = await this.empresasService.create(user, input);
    return { id };
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    return this.empresasService.get(user, id);
  }
}
