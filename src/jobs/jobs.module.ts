import { Module } from "@nestjs/common";
import { JobsController } from "./jobs.controller.js";
import { AuthModule } from "../auth/auth.module.js";
import { TareasModule } from "../tareas/tareas.module.js";
import { DocumentosModule } from "../documentos/documentos.module.js";
import { ReportesModule } from "../reportes/reportes.module.js";
import { CrmModule } from "../crm/crm.module.js";
import { ComercialModule } from "../comercial/comercial.module.js";
import { NotificacionesModule } from "../notificaciones/notificaciones.module.js";

// Trabajos diarios por endpoint (B5 del plan de fixes, 2-oct-2026): ver
// JobsController.
@Module({
  imports: [AuthModule, TareasModule, DocumentosModule, ReportesModule, CrmModule, ComercialModule, NotificacionesModule],
  controllers: [JobsController]
})
export class JobsModule {}
