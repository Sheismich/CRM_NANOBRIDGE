import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { contentDispositionAdjunto } from "../shared/content-disposition.js";
import { RegistroCambiosService } from "./registro-cambios.service.js";
import { SessionAuthGuard } from "../auth/guards/session-auth.guard.js";
import { RolesGuard } from "../auth/guards/roles.guard.js";
import { Roles } from "../auth/decorators/roles.decorator.js";
import { CurrentUser } from "../auth/decorators/current-user.decorator.js";
import type { CurrentUser as CurrentUserType } from "../auth/current-user.type.js";
import { ProblemasService } from "./problemas.service.js";
import { SaludService } from "./salud.service.js";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { reanudarFreno } from "../shared/freno-dominio.js";
import { listarRebotados, reactivarRebote } from "../shared/rebotes.js";
import { claveProblemaSchema, problemasQuerySchema, prospectoIdParamSchema, rebotesQuerySchema, registroCambiosExportQuerySchema, registroCambiosQuerySchema } from "./dto/admin.schema.js";

// Pantalla de Administración del rediseño (12-oct-2026): todo solo para el
// administrador -- es el "control" (quién movió qué, si todo funciona), no
// el trabajo del día (eso está en Reportes · Día).
@Controller("api/v1/admin")
@UseGuards(SessionAuthGuard, RolesGuard)
@Roles("administrador")
export class AdminController {
  constructor(
    private readonly saludService: SaludService,
    private readonly problemasService: ProblemasService,
    private readonly registroCambiosService: RegistroCambiosService,
    @Inject(DRIZZLE) private readonly db: DrizzleDb
  ) {}

  @Get("salud")
  salud() {
    return this.saludService.estado();
  }

  @Get("problemas")
  async problemas(@Query() query: Record<string, unknown>) {
    const { estado } = problemasQuerySchema.parse(query);
    return { grupos: await this.problemasService.grupos(estado) };
  }

  @Post("problemas/resolver")
  @HttpCode(200)
  resolver(@Body() body: unknown, @CurrentUser() actor: CurrentUserType) {
    return this.problemasService.resolver(actor, claveProblemaSchema.parse(body).clave);
  }

  @Post("freno-dominio/reanudar")
  @HttpCode(200)
  reanudarFreno(@CurrentUser() actor: CurrentUserType) {
    return reanudarFreno(this.db, actor);
  }

  // Los prospectos que un rebote desactivó (044, 20-nov-2026): la lista de
  // "Revisa la lista antes de reanudar".
  @Get("rebotes")
  async rebotes(@Query() query: Record<string, unknown>) {
    return { data: await listarRebotados(this.db, rebotesQuerySchema.parse(query).dias) };
  }

  @Post("rebotes/:prospectoId/reactivar")
  @HttpCode(200)
  reactivarRebote(@Param("prospectoId") prospectoId: string, @CurrentUser() actor: CurrentUserType) {
    return reactivarRebote(this.db, prospectoIdParamSchema.parse(prospectoId), actor);
  }

  @Get("registro-cambios")
  registroCambios(@Query() query: Record<string, unknown>) {
    return this.registroCambiosService.listar(registroCambiosQuerySchema.parse(query));
  }

  // Las opciones de los menús de filtros (acciones y personas).
  @Get("registro-cambios/filtros")
  filtrosRegistro() {
    return this.registroCambiosService.opcionesDeFiltros();
  }

  // PDF (hoja carta, molde común) o CSV, con los mismos filtros. @Res() sin
  // passthrough por lo mismo que /reportes/export: el cuerpo es el archivo.
  @Get("registro-cambios/export")
  async exportarRegistro(@Query() query: Record<string, unknown>, @CurrentUser() actor: CurrentUserType, @Res() response: Response) {
    const input = registroCambiosExportQuerySchema.parse(query);
    const { nombreArchivo, contenido } = await this.registroCambiosService.exportar(input, actor);
    response.status(200).set({
      "Content-Type": input.formato === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "Content-Disposition": contentDispositionAdjunto(nombreArchivo)
    }).send(contenido);
  }
}
