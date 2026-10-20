import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { IntegracionesModule } from "../integraciones/integraciones.module.js";
import { TareasModule } from "../tareas/tareas.module.js";
import { RespuestasVendedorController } from "./respuestas-vendedor.controller.js";
import { RespuestasVendedorService } from "./respuestas-vendedor.service.js";

// Etapa 3 de las mejoras (20-oct-2026): responder al prospecto desde el CRM,
// con borrador de IA. Usa la conexión directa con SendGrid y Gemini de la
// etapa 2 (src/integraciones).
@Module({
  imports: [AuthModule, IntegracionesModule, TareasModule],
  controllers: [RespuestasVendedorController],
  providers: [RespuestasVendedorService]
})
export class RespuestasVendedorModule {}
