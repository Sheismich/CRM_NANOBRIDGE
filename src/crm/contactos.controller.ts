import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { ContactosService } from "./contactos.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { updateContactSchema } from "./dto/empresa.schema.js";
import { createContactoSchema, listContactosQuerySchema } from "./dto/contacto.schema.js";

const idParamSchema = z.coerce.number().int().positive();

// Vista plana de los contactos, para buscar/abrir uno sin conocer antes su
// empresa. Las rutas anidadas /empresas/:id/contactos/* siguen existiendo y
// comparten la misma lógica (ver ContactosService). Mismos roles que las
// anidadas: escribir cualquier rol del CRM (un agente solo sobre sus
// empresas), incluida la baja -- ver EmpresasService.deactivateContact.
@Controller("api/v1/contactos")
@UseGuards(SessionAuthGuard, RolesGuard)
export class ContactosController {
  constructor(private readonly contactosService: ContactosService) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    return this.contactosService.list(user, listContactosQuerySchema.parse(query));
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  async create(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = await this.contactosService.create(user, createContactoSchema.parse(body));
    return { id };
  }

  @Get(":id")
  get(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    return this.contactosService.get(user, idParamSchema.parse(idParam));
  }

  @Patch(":id")
  @Roles("administrador", "supervisor", "agente")
  update(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.contactosService.update(user, idParamSchema.parse(idParam), updateContactSchema.parse(body));
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("administrador", "supervisor", "agente")
  async deactivate(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    await this.contactosService.deactivate(user, idParamSchema.parse(idParam));
  }
}
