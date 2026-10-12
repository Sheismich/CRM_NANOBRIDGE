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
// administrador, y esta es la misma información cruda, así que también va a
// quedar solo para él. Pero el front publicado todavía le enseña la pestaña
// Auditoría al supervisor: se cierra el día que el front nuevo pase a la liga
// normal (PLAN_FRONTEND.md, lista del día del cambio).
@Controller("api/v1/auditoria")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador", "supervisor")
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  list(@Query() query: Record<string, unknown>) {
    const parsed = listarAuditoriaQuerySchema.parse(query);
    return this.auditoriaService.list(parsed);
  }
}
