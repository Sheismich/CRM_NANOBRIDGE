import { Module } from "@nestjs/common";
import { EmpresasController } from "./empresas.controller.js";
import { EmpresasService } from "./empresas.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [EmpresasController],
  providers: [EmpresasService]
})
export class CrmModule {}
