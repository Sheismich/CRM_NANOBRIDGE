import { Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Observable, catchError, concatMap, from, throwError } from "rxjs";
import { avisosDeLaPeticion } from "./notificar.js";
import { NotificacionesService } from "./notificaciones.service.js";

// Para toda petición: abre la lista de avisos con correo (notificar() la
// llena) y, al terminar el handler (con su transacción ya confirmada), los
// manda antes de responder. Dentro de la misma petición porque en Cloud
// Run la CPU solo trabaja mientras hay una petición abierta. También si el
// handler falló: lo que alcanzó a confirmarse antes del error se avisa;
// lo que se deshizo ya no existe y no se manda.
@Injectable()
export class EnviarAvisosInterceptor implements NestInterceptor {
  constructor(private readonly notificacionesService: NotificacionesService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const avisos = { pendientes: [] as number[] };
    const enviar = async () => {
      const ids = avisos.pendientes.splice(0);
      if (ids.length > 0) await this.notificacionesService.enviarCorreos(ids);
    };
    // El handler corre al suscribirse: suscribirse dentro de run() le pasa la lista.
    return new Observable((subscriber) => avisosDeLaPeticion.run(avisos, () => next.handle().pipe(
      concatMap(async (valor) => {
        await enviar();
        return valor;
      }),
      catchError((error) => from(enviar()).pipe(concatMap(() => throwError(() => error))))
    ).subscribe(subscriber)));
  }
}
