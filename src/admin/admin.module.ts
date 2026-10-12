import { Module } from "@nestjs/common";
import { AdminController } from "./admin.controller.js";
import { ProblemasService } from "./problemas.service.js";
import { SaludService } from "./salud.service.js";
import { RegistroCambiosService } from "./registro-cambios.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";

@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [AdminController],
  providers: [ProblemasService, SaludService, RegistroCambiosService]
})
export class AdminModule {}
