import { Module } from "@nestjs/common";
import { OportunidadesController } from "./oportunidades.controller.js";
import { OportunidadesService } from "./oportunidades.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [OportunidadesController],
  providers: [OportunidadesService]
})
export class ComercialModule {}
