import { Module } from "@nestjs/common";
import { EmpresasController } from "./empresas.controller.js";
import { EmpresasService } from "./empresas.service.js";
import { ActividadesController } from "./actividades.controller.js";
import { ActividadesService } from "./actividades.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [EmpresasController, ActividadesController],
  providers: [EmpresasService, ActividadesService]
})
export class CrmModule {}
