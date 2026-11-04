import { Module } from "@nestjs/common";
import { DatabaseModule } from "./database/database.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { CrmModule } from "./crm/crm.module.js";
import { TareasModule } from "./tareas/tareas.module.js";
import { ProcesosFallidosModule } from "./procesos-fallidos/procesos-fallidos.module.js";
import { AutomatizacionModule } from "./automatizacion/automatizacion.module.js";
import { ComercialModule } from "./comercial/comercial.module.js";
import { ReportesModule } from "./reportes/reportes.module.js";
import { DocumentosModule } from "./documentos/documentos.module.js";
import { UsuariosModule } from "./usuarios/usuarios.module.js";
import { CampanasModule } from "./campanas/campanas.module.js";
import { PlantillasModule } from "./plantillas/plantillas.module.js";
import { JobsModule } from "./jobs/jobs.module.js";
import { NotificacionesModule } from "./notificaciones/notificaciones.module.js";
import { RespuestasVendedorModule } from "./respuestas-vendedor/respuestas-vendedor.module.js";
import { ResumenFichaModule } from "./resumen-ficha/resumen-ficha.module.js";
import { AdminModule } from "./admin/admin.module.js";
import { BuscadorModule } from "./buscador/buscador.module.js";
import { HealthController } from "./health/health.controller.js";

@Module({
  imports: [DatabaseModule, AuthModule, CrmModule, TareasModule, ProcesosFallidosModule, AutomatizacionModule, ComercialModule, ReportesModule, DocumentosModule, UsuariosModule, CampanasModule, PlantillasModule, NotificacionesModule, RespuestasVendedorModule, ResumenFichaModule, JobsModule, AdminModule, BuscadorModule],
  controllers: [HealthController]
})
export class AppModule {}
