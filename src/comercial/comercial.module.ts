import { Module } from "@nestjs/common";
import { OportunidadesController } from "./oportunidades.controller.js";
import { OportunidadesService } from "./oportunidades.service.js";
import { CotizacionesController } from "./cotizaciones.controller.js";
import { CotizacionesService } from "./cotizaciones.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [OportunidadesController, CotizacionesController],
  providers: [OportunidadesService, CotizacionesService]
})
export class ComercialModule {}
