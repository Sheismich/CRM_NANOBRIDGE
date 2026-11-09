import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { PlantillasService } from "./plantillas.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { editarPieSchema, editarPlantillaSchema, numeroPlantillaSchema, plantillasQuerySchema, quitarPlantillaQuerySchema, vistaPreviaSchema } from "./dto/plantilla.schema.js";

// Correos de prospección (Administración). Solo administrador y supervisor:
// deciden lo que se le escribe a los prospectos. El agente no los ve.
@Controller("api/v1/plantillas")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador", "supervisor")
export class PlantillasController {
  constructor(private readonly plantillasService: PlantillasService) {}

  // ?campana_id=: los 3 que se usarían en esa campaña (propios o generales).
  @Get()
  listar(@Query() query: unknown) {
    return this.plantillasService.listar(plantillasQuerySchema.parse(query).campana_id);
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

  // El de una campaña vuelve al general de ese número.
  @Delete(":numero")
  quitar(@Param("numero") numero: string, @Query() query: unknown, @CurrentUser() user: CurrentUserType) {
    return this.plantillasService.quitar(user, numeroPlantillaSchema.parse(numero), quitarPlantillaQuerySchema.parse(query).campana_id);
  }

  @Post("vista-previa")
  @HttpCode(200)
  vistaPrevia(@Body() body: unknown) {
    return this.plantillasService.vistaPrevia(vistaPreviaSchema.parse(body));
  }
}
