import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditoriaService } from "./auditoria.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { listarAuditoriaQuerySchema } from "./dto/auditoria.schema.js";

// Todo el controller es de solo lectura -- se declara @Roles una sola vez
// aquí arriba en vez de repetirlo por ruta (a diferencia de
// UsuariosController, que sí mezcla niveles de acceso entre sus rutas).
// El Registro de cambios de Administración ("quién movió qué") es solo del
// administrador, y esta es la misma información cruda, así que también es
// solo para él (día del cambio, 15-oct-2026: el front nuevo ya no tiene la
// pestaña Auditoría del supervisor).
@Controller("api/v1/auditoria")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador")
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const parsed = listarAuditoriaQuerySchema.parse(query);
    return this.auditoriaService.list(parsed);
  }
}
