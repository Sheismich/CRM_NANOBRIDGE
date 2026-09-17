import { Module } from "@nestjs/common";
import { EmpresasController } from "./empresas.controller.js";
import { EmpresasService } from "./empresas.service.js";
import { ActividadesController } from "./actividades.controller.js";
import { ActividadesService } from "./actividades.service.js";
import { ProspectosController } from "./prospectos.controller.js";
import { ProspectosService } from "./prospectos.service.js";
import { CatalogosController } from "./catalogos.controller.js";
import { CatalogosService } from "./catalogos.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [EmpresasController, ActividadesController, ProspectosController, CatalogosController],
  providers: [EmpresasService, ActividadesService, ProspectosService, CatalogosService]
})
export class CrmModule {}
