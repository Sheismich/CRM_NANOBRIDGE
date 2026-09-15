import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { SessionAuthGuard } from "./guards/session-auth.guard.js";
import { RateLimitGuard } from "./guards/rate-limit.guard.js";
import { CurrentUser } from "./decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "./current-user.type.js";
import { bootstrapSchema, credentialsSchema } from "./dto/credentials.schema.js";
import { env } from "../config/env.js";

const QUINCE_MINUTOS_MS = 15 * 60 * 1000;

// Instancias con nombre (no anónimas dentro de @UseGuards) porque login()
// necesita la MISMA referencia para llamar release() tras un login
// correcto -- ver el comentario ahí y en rate-limit.guard.ts.
const bootstrapRateLimit = new RateLimitGuard({ max: 5, windowMs: QUINCE_MINUTOS_MS });
const loginRateLimit = new RateLimitGuard({ max: 10, windowMs: QUINCE_MINUTOS_MS });

@Controller("api/v1/auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService
  ) {}

  // Tope más estricto que login: bootstrap solo debería usarse una vez de
  // verdad (auth.service.ts lo rechaza en cuanto ya existe un usuario), así
  // que después de eso cualquier volumen de intentos es ruido/abuso, nunca
  // tráfico legítimo repetido (hallazgo de auditoría, 14-sep-2026: ninguna
  // de las dos rutas tenía límite de intentos). Cada llamada cuenta, tenga
  // éxito o no -- a diferencia de login, aquí no hay "usuarios legítimos
  // compartiendo IP" que puedan verse afectados por eso, así que basta con
  // el guard (canActivate() ya cuenta solo, no hace falta llamar nada más).
  @Post("bootstrap")
  @HttpCode(201)
  @UseGuards(bootstrapRateLimit)
  async bootstrap(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = bootstrapSchema.parse(body);
    const { user, session } = await this.authService.bootstrap(input);
    this.sessionService.setSessionCookie(response, session.token, session.expiresAt);
    return user;
  }

  // El guard cuenta el intento de forma síncrona en canActivate() (antes de
  // cualquier await de esta ruta); en cuanto se confirma que las
  // credenciales son correctas, release() devuelve ese cupo -- así varios
  // usuarios legítimos detrás de la misma IP/NAT (oficina compartida)
  // pueden iniciar sesión sin bloquearse entre sí, pero CUALQUIER otro
  // desenlace (contraseña incorrecta, body inválido, un error de
  // infraestructura) se queda contado por default, sin tener que
  // enumerarlo a mano (hallazgo de code-review, 15-sep-2026: la versión
  // anterior solo contaba dentro de un catch, así que una racha de
  // peticiones CONCURRENTES -- no una por una -- podía pasar todas antes
  // de que cualquiera alcanzara a contar).
  @Post("login")
  @HttpCode(200)
  @UseGuards(loginRateLimit)
  async login(@Req() request: Request, @Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = credentialsSchema.parse(body);
    const { user, session } = await this.authService.login(input);
    loginRateLimit.release(request);
    this.sessionService.setSessionCookie(response, session.token, session.expiresAt);
    return user;
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.sessionService.deleteSession(request.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined);
    this.sessionService.clearSessionCookie(response);
  }

  @Get("me")
  @UseGuards(SessionAuthGuard)
  me(@CurrentUser() user: CurrentUserType) {
    return user;
  }
}
