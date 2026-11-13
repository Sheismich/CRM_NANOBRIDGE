import { Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { RateLimitGuard } from "../auth/guards/rate-limit.guard.js";
import { RUTA_BAJA } from "../shared/link-baja.js";
import { BajaService } from "./baja.service.js";
import { paginaDeBaja, type VistaBaja } from "./pagina-baja.js";

// Tope por IP para el botón: una persona lo aprieta una o dos veces. Es
// amplio porque una oficina completa sale por la misma IP.
const limiteDeBajas = new RateLimitGuard({ max: 30, windowMs: 10 * 60 * 1000 });

// Página pública (sin sesión ni llave): la abre el prospecto desde su
// correo. Responde HTML, no JSON. Ver BajaService y shared/link-baja.ts.
@Controller(RUTA_BAJA.replace(/^\//, ""))
export class BajaController {
  constructor(private readonly bajaService: BajaService) {}

  @Get(":token")
  @Header("Cache-Control", "no-store")
  @Header("X-Robots-Tag", "noindex, nofollow")
  @Header("Referrer-Policy", "no-referrer")
  async abrir(@Param("token") token: string, @Res({ passthrough: true }) response: Response) {
    return this.responder(response, await this.bajaService.abrir(token), token);
  }

  @Post(":token")
  @HttpCode(200)
  @UseGuards(limiteDeBajas)
  @Header("Cache-Control", "no-store")
  @Header("X-Robots-Tag", "noindex, nofollow")
  @Header("Referrer-Policy", "no-referrer")
  async confirmar(@Param("token") token: string, @Res({ passthrough: true }) response: Response) {
    return this.responder(response, await this.bajaService.confirmar(token), token);
  }

  private responder(response: Response, vista: VistaBaja, token: string) {
    if (vista === "invalido") response.status(404);
    response.type("html");
    // El token ya pasó la revisión de forma (solo dígitos, punto y hex)
    // cuando la vista es "confirmar": se puede poner tal cual en el HTML.
    return paginaDeBaja(vista, vista === "confirmar" ? `${RUTA_BAJA}/${token}` : "");
  }
}
