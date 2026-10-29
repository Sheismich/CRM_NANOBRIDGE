import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { EmpresasService } from "./empresas.service.js";
import { FusionEmpresasService } from "./fusion-empresas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { companyInputSchema, contactInputSchema, listEmpresasQuerySchema, updateCompanySchema, updateContactSchema } from "./dto/empresa.schema.js";

const idParamSchema = z.coerce.number().int().positive();
const parecidasQuerySchema = z.object({
  nombre: z.string().trim().min(1).max(255),
  excluir: z.coerce.number().int().positive().optional()
});
const fusionarBodySchema = z.object({
  destinoId: z.number().int().positive(),
  simular: z.boolean().default(false)
});

@Controller("api/v1/empresas")
@UseGuards(SessionAuthGuard, RolesGuard)
export class EmpresasController {
  constructor(
    private readonly empresasService: EmpresasService,
    private readonly fusionEmpresasService: FusionEmpresasService
  ) {}

  @Get()
  list(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const { page, limit, ...filtros } = listEmpresasQuerySchema.parse(query);
    return this.empresasService.list(user, page, limit, filtros);
  }

  // Tarjetas de arriba de la lista (antes de @Get(":id")).
  @Get("conteos")
  conteos(@CurrentUser() user: CurrentUserType) {
    return this.empresasService.conteos(user);
  }

  // Empresas con el mismo nombre que la que se va a dar de alta (control G-01).
  // Antes de @Get(":id").
  @Get("parecidas")
  parecidas(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const input = parecidasQuerySchema.parse(query);
    return this.empresasService.parecidas(user, input.nombre, input.excluir);
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

  @Patch(":id")
  @Roles("administrador", "supervisor", "agente")
  update(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = updateCompanySchema.parse(body);
    return this.empresasService.update(user, id, input);
  }

  // Fusionar esta empresa (la repetida) en otra (control G-05). Solo
  // administrador. simular=true dice qué se movería sin tocar nada.
  @Post(":id/fusionar")
  @HttpCode(200)
  @Roles("administrador")
  fusionar(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = fusionarBodySchema.parse(body ?? {});
    return this.fusionEmpresasService.fusionar(user, id, input.destinoId, input.simular);
  }

  // Solo administrador/supervisor -- ver comentario en EmpresasService.deactivate.
  @Delete(":id")
  @HttpCode(204)
  @Roles("administrador", "supervisor")
  async deactivate(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    await this.empresasService.deactivate(user, id);
  }

  @Post(":id/contactos")
  @HttpCode(201)
  @Roles("administrador", "supervisor", "agente")
  async addContact(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = contactInputSchema.parse(body);
    const contactoId = await this.empresasService.addContact(user, id, input);
    return { id: contactoId };
  }

  @Patch(":id/contactos/:contactoId")
  @Roles("administrador", "supervisor", "agente")
  updateContact(@Param("id") idParam: string, @Param("contactoId") contactoIdParam: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const contactoId = idParamSchema.parse(contactoIdParam);
    const input = updateContactSchema.parse(body);
    return this.empresasService.updateContact(user, id, contactoId, input);
  }

  @Delete(":id/contactos/:contactoId")
  @HttpCode(204)
  @Roles("administrador", "supervisor", "agente")
  async deactivateContact(@Param("id") idParam: string, @Param("contactoId") contactoIdParam: string, @CurrentUser() user: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const contactoId = idParamSchema.parse(contactoIdParam);
    await this.empresasService.deactivateContact(user, id, contactoId);
  }
}
