import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { IntegracionesModule } from "../integraciones/integraciones.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { ComercialModule } from "../comercial/comercial.module.js";
import { TareasModule } from "../tareas/tareas.module.js";
import { ResumenFichaController } from "./resumen-ficha.controller.js";
import { ResumenFichaService } from "./resumen-ficha.service.js";

// Etapa 4 de las mejoras: "Resumir con IA" en la ficha del cliente.
@Module({
  imports: [AuthModule, IntegracionesModule, CrmModule, ComercialModule, TareasModule],
  controllers: [ResumenFichaController],
  providers: [ResumenFichaService]
})
export class ResumenFichaModule {}
