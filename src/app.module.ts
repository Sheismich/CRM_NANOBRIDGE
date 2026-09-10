import { Module } from "@nestjs/common";
import { ScheduleModule } from "@nestjs/schedule";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CrmModule } from "./crm/crm.module.js";
import { TareasModule } from "./tareas/tareas.module.js";
import { OutboxModule } from "./outbox/outbox.module.js";
import { AutomatizacionModule } from "./automatizacion/automatizacion.module.js";
import { ComercialModule } from "./comercial/comercial.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  // ScheduleModule.forRoot() habilita @Interval() en OutboxDispatcherService
  // (el despachador del patrón outbox corre solo, sin cron externo).
  imports: [ScheduleModule.forRoot(), DatabaseModule, AuthModule, CrmModule, TareasModule, OutboxModule, AutomatizacionModule, ComercialModule],
  controllers: [HealthController]
})
export class AppModule {}
