import { Module } from "@nestjs/common";
import { OutboxService } from "./outbox.service.js";
import { OutboxDispatcherService } from "./outbox-dispatcher.service.js";
import { EventosPendientesController } from "./eventos-pendientes.controller.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [EventosPendientesController],
  providers: [OutboxService, OutboxDispatcherService],
  exports: [OutboxService]
})
export class OutboxModule {}
