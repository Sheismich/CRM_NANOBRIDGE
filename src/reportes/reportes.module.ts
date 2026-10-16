import { Module } from "@nestjs/common";
import { ReportesController } from "./reportes.controller.js";
import { ReportesService } from "./reportes.service.js";
import { ReporteDiaService } from "./reporte-dia.service.js";
import { InformeEjecutivoService } from "./informe-ejecutivo.service.js";
import { ReportePeriodoService } from "./reporte-periodo.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ReportesController],
  providers: [ReportesService, ReporteDiaService, InformeEjecutivoService, ReportePeriodoService],
  exports: [ReportesService]
})
export class ReportesModule {}
