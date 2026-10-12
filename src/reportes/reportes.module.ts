import { Module } from "@nestjs/common";
import { ReportesController } from "./reportes.controller.js";
import { ReportesService } from "./reportes.service.js";
import { ReporteDiaService } from "./reporte-dia.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ReportesController],
  providers: [ReportesService, ReporteDiaService],
  exports: [ReportesService]
})
export class ReportesModule {}
