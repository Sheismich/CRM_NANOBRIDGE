import { Module } from "@nestjs/common";
import { ProcesosFallidosService } from "./procesos-fallidos.service.js";
import { ProcesosFallidosController } from "./procesos-fallidos.controller.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [ProcesosFallidosController],
  providers: [ProcesosFallidosService],
  exports: [ProcesosFallidosService]
})
export class ProcesosFallidosModule {}
