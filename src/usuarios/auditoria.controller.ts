import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuditoriaService } from "./auditoria.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { listarAuditoriaQuerySchema } from "./dto/auditoria.schema.js";

// Todo el controller es de solo lectura y restringido a
// administrador/supervisor -- se declara @Roles una sola vez aquí arriba
// en vez de repetirlo por ruta (a diferencia de UsuariosController, que sí
// mezcla niveles de acceso entre sus rutas).
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
