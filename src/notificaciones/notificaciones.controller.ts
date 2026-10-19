import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { NotificacionesService } from "./notificaciones.service.js";

const listarQuerySchema = z.object({
  solo_no_leidas: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  limit: z.coerce.number().int().min(1).max(100).default(30)
});

const idParamSchema = z.coerce.number().int().positive();

const preferenciasSchema = z.object({ avisos_por_correo: z.boolean() });

// La campanita: cada quien ve y marca solo sus avisos, sea cual sea su rol.
@Controller("api/v1/notificaciones")
@UseGuards(SessionAuthGuard)
export class NotificacionesController {
  constructor(private readonly notificacionesService: NotificacionesService) {}

  @Get()
  listar(@Query() query: Record<string, unknown>, @CurrentUser() user: CurrentUserType) {
    const { solo_no_leidas, limit } = listarQuerySchema.parse(query);
    return this.notificacionesService.listar(user, { soloNoLeidas: solo_no_leidas, limit });
  }

  // El numerito: el front lo pide cada minuto.
  @Get("conteo")
  async conteo(@CurrentUser() user: CurrentUserType) {
    return { no_leidas: await this.notificacionesService.noLeidas(user) };
  }

  @Get("preferencias")
  preferencias(@CurrentUser() user: CurrentUserType) {
    return this.notificacionesService.preferencias(user);
  }

  @Put("preferencias")
  cambiarPreferencias(@Body() body: unknown, @CurrentUser() user: CurrentUserType) {
    return this.notificacionesService.cambiarPreferencias(user, preferenciasSchema.parse(body));
  }

  @Post("leer-todas")
  @HttpCode(200)
  leerTodas(@CurrentUser() user: CurrentUserType) {
    return this.notificacionesService.leerTodas(user);
  }

  @Patch(":id/leida")
  @HttpCode(204)
  async marcarLeida(@Param("id") idParam: string, @CurrentUser() user: CurrentUserType) {
    await this.notificacionesService.marcarLeida(user, idParamSchema.parse(idParam));
  }
}
