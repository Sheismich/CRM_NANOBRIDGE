import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { RateLimitGuard } from "../auth/guards/rate-limit.guard.js";
import { ENCABEZADO_FIRMA, ENCABEZADO_TIMESTAMP } from "../shared/firma-sendgrid.js";
import { SendgridEventosService } from "./sendgrid-eventos.service.js";

// SendGrid manda lotes cada ~30 s por servidor; el tope es solo contra abuso.
const limiteDeLotes = new RateLimitGuard({ max: 600, windowMs: 60 * 1000 });

// Público (sin sesión ni llave): lo llama SendGrid. Lo protege la firma del
// Signed Event Webhook (shared/firma-sendgrid.ts).
@Controller("api/v1/webhooks/sendgrid")
export class SendgridEventosController {
  constructor(private readonly service: SendgridEventosService) {}

  @Post("eventos")
  @HttpCode(200)
  @UseGuards(limiteDeLotes)
  recibir(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers(ENCABEZADO_FIRMA) firma: string | undefined,
    @Headers(ENCABEZADO_TIMESTAMP) timestamp: string | undefined,
    @Body() body: unknown
  ) {
    return this.service.recibir(req.rawBody, firma, timestamp, body);
  }
}
