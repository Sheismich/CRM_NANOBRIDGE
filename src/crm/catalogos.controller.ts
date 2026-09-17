import { Controller, Get, UseGuards } from "@nestjs/common";
import { CatalogosService } from "./catalogos.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";

// Catálogos para la UI del CRM (PLAN_API_DEFINITIVO.md, "Endpoints CRM") --
// sesión de usuario, sin restricción de rol (cualquier rol autenticado
// arma sus propios formularios con esto). Mismo contenido que
// GET /automatizacion/catalogos, pero ese usa X-API-Key para n8n; el CRM no
// tiene ni debe tener esa llave. El catálogo de etapa del embudo / motivo de
// pérdida vive aparte, en GET /oportunidades/catalogos, porque es propio de
// ese módulo (tablas catalogo_etapa_embudo / catalogo_motivo_perdida), no un
// ENUM genérico.
@Controller("api/v1/catalogos")
@UseGuards(SessionAuthGuard, RolesGuard)
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Get()
  catalogos() {
    return this.catalogosService.obtenerCatalogos();
  }
}
