import { Module } from "@nestjs/common";
import { UsuariosController } from "./usuarios.controller.js";
import { UsuariosService } from "./usuarios.service.js";
import { AuditoriaController } from "./auditoria.controller.js";
import { AuditoriaService } from "./auditoria.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [UsuariosController, AuditoriaController],
  providers: [UsuariosService, AuditoriaService]
})
export class UsuariosModule {}
