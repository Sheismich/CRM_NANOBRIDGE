import { Module } from "@nestjs/common";
import { OutboxService } from "./outbox.service.js";
import { OutboxDispatcherService } from "./outbox-dispatcher.service.js";
import { EventosPendientesController } from "./eventos-pendientes.controller.js";
import { ProcesosFallidosController } from "./procesos-fallidos.controller.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [EventosPendientesController, ProcesosFallidosController],
  providers: [OutboxService, OutboxDispatcherService],
  exports: [OutboxService]
})
export class OutboxModule {}
