import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { AuthModule } from "../auth/auth.module.js";
import { IntegracionesModule } from "../integraciones/integraciones.module.js";
import { NotificacionesController } from "./notificaciones.controller.js";
import { NotificacionesService } from "./notificaciones.service.js";
import { EnviarAvisosInterceptor } from "./enviar-avisos.interceptor.js";

// Avisos al vendedor (etapa 2 de las mejoras, 19-oct-2026). Los demás
// módulos no necesitan importarlo: crean avisos con notificar() (función,
// dentro de su transacción) y el interceptor global manda los correos.
@Module({
  imports: [AuthModule, IntegracionesModule],
  controllers: [NotificacionesController],
  providers: [NotificacionesService, { provide: APP_INTERCEPTOR, useClass: EnviarAvisosInterceptor }],
  exports: [NotificacionesService]
})
export class NotificacionesModule {}
