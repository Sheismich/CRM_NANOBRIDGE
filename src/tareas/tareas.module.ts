import { Module } from "@nestjs/common";
import { TareasController } from "./tareas.controller.js";
import { ColaClasificacionController } from "./cola-clasificacion.controller.js";
import { TareasService } from "./tareas.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";

@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [TareasController, ColaClasificacionController],
  providers: [TareasService],
  // Exportado para que AutomatizacionModule reuse createFromAutomation()
  // en vez de duplicar el acceso a la tabla tareas.
  exports: [TareasService]
})
export class TareasModule {}
