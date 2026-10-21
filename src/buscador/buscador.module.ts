import { Module } from "@nestjs/common";
import { BuscadorController } from "./buscador.controller.js";
import { BuscadorService } from "./buscador.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [BuscadorController],
  providers: [BuscadorService]
})
export class BuscadorModule {}
