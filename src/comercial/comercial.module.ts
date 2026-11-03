import { Module } from "@nestjs/common";
import { OportunidadesController } from "./oportunidades.controller.js";
import { OportunidadesService } from "./oportunidades.service.js";
import { CotizacionesController } from "./cotizaciones.controller.js";
import { CotizacionesService } from "./cotizaciones.service.js";
import { CorreoCotizacionService } from "./correo-cotizacion.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { IntegracionesModule } from "../integraciones/integraciones.module.js";

@Module({
  imports: [AuthModule, IntegracionesModule],
  controllers: [OportunidadesController, CotizacionesController],
  providers: [OportunidadesService, CotizacionesService, CorreoCotizacionService],
  // JobsModule: vencer cotizaciones en el trabajo diario.
  exports: [CotizacionesService, OportunidadesService]
})
export class ComercialModule {}
