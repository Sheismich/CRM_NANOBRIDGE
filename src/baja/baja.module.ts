import { Module } from "@nestjs/common";
import { BajaController } from "./baja.controller.js";
import { BajaService } from "./baja.service.js";

@Module({
  controllers: [BajaController],
  providers: [BajaService]
})
export class BajaModule {}
