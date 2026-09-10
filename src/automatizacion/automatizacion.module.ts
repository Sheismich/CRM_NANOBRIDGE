import { Module } from "@nestjs/common";
import { AutomatizacionController } from "./automatizacion.controller.js";
import { AutomatizacionService } from "./automatizacion.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { TareasModule } from "../tareas/tareas.module.js";

@Module({
  imports: [AuthModule, TareasModule],
  controllers: [AutomatizacionController],
  providers: [AutomatizacionService]
})
export class AutomatizacionModule {}
