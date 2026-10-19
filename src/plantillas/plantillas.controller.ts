import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from "@nestjs/common";
import { PlantillasService } from "./plantillas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { editarPieSchema, editarPlantillaSchema, numeroPlantillaSchema, vistaPreviaSchema } from "./dto/plantilla.schema.js";

// Correos de prospección (Administración). Solo administrador y supervisor:
// deciden lo que se le escribe a los prospectos. El agente no los ve.
@Controller("api/v1/plantillas")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador", "supervisor")
export class PlantillasController {
  constructor(private readonly plantillasService: PlantillasService) {}

  @Get()
  listar() {
    return this.plantillasService.listar();
  }

  // Antes de ":numero" para que "pie" no caiga ahí.
  @Put("pie")
  editarPie(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.plantillasService.editarPie(user, editarPieSchema.parse(body));
  }

  @Put(":numero")
  editar(@Param("numero") numero: string, @Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.plantillasService.editar(user, numeroPlantillaSchema.parse(numero), editarPlantillaSchema.parse(body));
  }

  @Post("vista-previa")
  @HttpCode(200)
  vistaPrevia(@Body() body: unknown) {
    return this.plantillasService.vistaPrevia(vistaPreviaSchema.parse(body));
  }
}
