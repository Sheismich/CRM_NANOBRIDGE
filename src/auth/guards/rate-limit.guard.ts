import { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { HttpError } from "../../shared/http-error.js";

interface RateLimitOptions {
  max: number;
  windowMs: number;
}

// Se usa como @UseGuards(instancia) -- NO como provider inyectado por Nest
// (por eso no lleva @Injectable(): ambos usos son "new RateLimitGuard(...)"
// a mano en auth.controller.ts, nunca resuelto por el contenedor de Nest;
// decorarla como si lo fuera sugeriría un ciclo de vida/DI que no aplica
// -- hallazgo de code-review, 15-sep-2026) -- así cada ruta decorada tiene
// su PROPIA instancia (y su propio conteo por IP) con solo escribirla una
// vez, que es exactamente lo que hace falta para limitar login y bootstrap
// con topes distintos entre sí, sin instalar/configurar un paquete de
// throttling genérico para dos rutas (mismo criterio que el parser CSV
// propio en shared/csv.ts: sin dependencia nueva cuando el problema es
// chico y acotado). Memoria de proceso, no distribuida -- suficiente
// mientras la API corra como una sola instancia (PLAN_API_DEFINITIVO.md:
// "backend modular único").
//
// canActivate() cuenta el intento DE FORMA SÍNCRONA, antes de que la ruta
// haga cualquier await (hallazgo de code-review, 15-sep-2026: la versión
// anterior solo incrementaba el conteo DESPUÉS de esperar a la consulta a
// MySQL + verificar la contraseña con argon2, así que varias peticiones
// concurrentes podían pasar el chequeo todas a la vez antes de que
// cualquiera alcanzara a contar -- el límite se podía saltar mandando
// varias peticiones al mismo tiempo en vez de una por una). Si la petición
// resulta ser legítima, quien la maneja llama a release() para devolver
// ese cupo -- así un login correcto no cuenta contra el límite (varios
// compañeros de oficina detrás de la misma IP/NAT no se bloquean entre
// sí), pero CUALQUIER otro desenlace (contraseña incorrecta, body
// inválido, un error de infraestructura) se queda contado por default, sin
// tener que enumerar cada caso a mano.
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private lastCleanup = Date.now();

  constructor(private readonly options: RateLimitOptions) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const now = Date.now();
    this.cleanupIfDue(now);

    const key = this.keyFor(request);
    const entry = this.hits.get(key);
    if (!entry || now >= entry.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.options.windowMs });
      return true;
    }

    if (entry.count >= this.options.max) {
      response.setHeader("Retry-After", Math.ceil((entry.resetAt - now) / 1000));
      throw new HttpError(429, "Demasiados intentos, intenta de nuevo más tarde");
    }

    entry.count++;
    return true;
  }

  // Devuelve el cupo que canActivate() ya había reservado, para el caso en
  // que la petición resultó legítima -- debe llamarse en cuanto se
  // confirme el éxito, lo antes posible dentro del handler: cualquier
  // fallo que ocurra DESPUÉS de esa llamada (ej. al firmar la cookie de
  // sesión, ya con las credenciales verificadas) tampoco cuenta, que es
  // justo la intención -- solo un intento realmente incorrecto debe costar
  // cupo.
  release(request: Request) {
    const entry = this.hits.get(this.keyFor(request));
    if (entry && entry.count > 0) entry.count--;
  }

  // request.ip usa Express' trust-proxy setting -- ver TRUST_PROXY en
  // env.ts/main.ts. Sin confiar en el proxy correcto, todo el tráfico real
  // llegaría con la MISMA ip (la del proxy), convirtiendo el límite "por
  // IP" en un límite global compartido por todos los usuarios (hallazgo de
  // code-review, 15-sep-2026).
  private keyFor(request: Request) {
    return request.ip ?? "unknown";
  }

  // Purga entradas vencidas en vez de dejar crecer el Map para siempre --
  // se revisa como mucho una vez por ventana (no en cada request), así que
  // el costo extra es insignificante frente al riesgo real de fuga de
  // memoria en un proceso que corre semanas.
  private cleanupIfDue(now: number) {
    if (now - this.lastCleanup < this.options.windowMs) return;
    for (const [key, entry] of this.hits) {
      if (entry.resetAt < now) this.hits.delete(key);
    }
    this.lastCleanup = now;
  }
}
