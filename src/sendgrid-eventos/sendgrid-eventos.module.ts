import { Module } from "@nestjs/common";
import { SendgridEventosController } from "./sendgrid-eventos.controller.js";
import { SendgridEventosService } from "./sendgrid-eventos.service.js";

@Module({
  controllers: [SendgridEventosController],
  providers: [SendgridEventosService]
})
export class SendgridEventosModule {}
