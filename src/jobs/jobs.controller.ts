import { Controller, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ApiKeyGuard } from "../auth/guards/api-key.guard.js";
import { AuthService } from "../auth/auth.service.js";
import { TareasService } from "../tareas/tareas.service.js";
import { DocumentosService } from "../documentos/documentos.service.js";
import { ReportesService } from "../reportes/reportes.service.js";
import { ProspectosService } from "../crm/prospectos.service.js";
import { HttpError } from "../shared/http-error.js";
import { fechaMx } from "../shared/dia-habil.js";

// Trabajos diarios disparados por n8n (B5 del plan de fixes, 2-oct-2026).
// Antes eran @Interval(24h), que en Cloud Run nunca corrían: la instancia se
// apaga sola cuando no hay tráfico (minScale 0) y la CPU solo trabaja
// durante peticiones, así que el reloj de 24 h nunca llegaba. Ahora el
// workflow "PT5. trabajos diarios" de n8n llama este endpoint cada día con la
// API key. Todos son idempotentes: correrlos dos veces no duplica nada.
@Controller("api/v1/automatizacion/jobs")
@UseGuards(ApiKeyGuard)
export class JobsController {
  // Un solo mapa de nombre → trabajo, en vez de un switch.
  private readonly trabajos: Record<string, () => Promise<Record<string, unknown>>>;

  constructor(
    authService: AuthService,
    tareasService: TareasService,
    documentosService: DocumentosService,
    reportesService: ReportesService,
    prospectosService: ProspectosService
  ) {
    this.trabajos = {
      // Tareas abiertas con su fecha límite vencida (p. ej. "Contactar
      // prospecto interesado" que nadie tomó).
      "sla-tareas": async () => ({ procesados: await tareasService.alertarTareasSlaVencidas() }),
      // Documentos vigentes sin revisar después de 7 días.
      "documentos-pendientes": async () => ({ procesados: await documentosService.alertarDocumentosPendientes() }),
      // El día ANTERIOR completo, en hora de México (n8n lo corre en la mañana).
      "metricas-diarias": async () => {
        const fecha = fechaMx(new Date(Date.now() - 24 * 60 * 60 * 1000));
        await reportesService.calcularMetricasDelDia(fecha);
        return { procesados: 1, fecha };
      },
      // Borradores de importación vencidos + contadores viejos de login.
      "limpiar-borradores": async () => ({
        procesados: await prospectosService.limpiarBorradoresVencidos() + await authService.limpiarLoginFallosViejos()
      })
    };
  }

  @Post(":nombre")
  @HttpCode(200)
  async correr(@Param("nombre") nombre: string) {
    const trabajo = Object.hasOwn(this.trabajos, nombre) ? this.trabajos[nombre] : undefined;
    if (!trabajo) throw new HttpError(404, "Trabajo no encontrado");
    return { job: nombre, ...(await trabajo()) };
  }
}
