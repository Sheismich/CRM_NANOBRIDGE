import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { UsuariosService } from "./usuarios.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { actualizarUsuarioSchema, crearUsuarioSchema, listarUsuariosQuerySchema } from "./dto/usuario.schema.js";

const idParamSchema = z.coerce.number().int().positive();

@Controller("api/v1/usuarios")
@UseGuards(SessionAuthGuard, RolesGuard)
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  // A diferencia de EmpresasController.list() (abierto a cualquier sesión
  // válida), aquí SÍ hace falta @Roles explícito: administrar/consultar
  // cuentas de usuario es más sensible que leer empresas, un agente no
  // tiene por qué ver el listado completo de usuarios del sistema.
  @Get()
  @Roles("administrador", "supervisor")
  list(@Query() query: Record<string, unknown>) {
    const parsed = listarUsuariosQuerySchema.parse(query);
    return this.usuariosService.list(parsed);
  }

  @Get(":id")
  @Roles("administrador", "supervisor")
  get(@Param("id") idParam: string) {
    const id = idParamSchema.parse(idParam);
    return this.usuariosService.get(id);
  }

  @Post()
  @HttpCode(201)
  @Roles("administrador")
  async create(@Body() body: unknown, @CurrentUser() actor: CurrentUserType) {
    const input = crearUsuarioSchema.parse(body);
    const id = await this.usuariosService.create(actor, input);
    return { id };
  }

  @Patch(":id")
  @Roles("administrador")
  update(@Param("id") idParam: string, @Body() body: unknown, @CurrentUser() actor: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    const input = actualizarUsuarioSchema.parse(body);
    return this.usuariosService.update(actor, id, input);
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("administrador")
  async deactivate(@Param("id") idParam: string, @CurrentUser() actor: CurrentUserType) {
    const id = idParamSchema.parse(idParam);
    await this.usuariosService.deactivate(actor, id);
  }
}
