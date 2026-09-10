import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { AutomatizacionService } from "./automatizacion.service.js";
import { TareasService } from "../tareas/tareas.service.js";
import { ApiKeyGuard } from "../auth/guards/api-key.guard.js";
import {
  campanaActivaQuerySchema,
  consultaSupresionQuerySchema,
  estadoProspectoInputSchema,
  incidenciaInputSchema,
  registroProspectoInputSchema,
  registroSupresionInputSchema,
  scoringInputSchema,
  tareaAutomatizacionInputSchema,
  validacionInputSchema
} from "./dto/automatizacion.schema.js";

// Endpoints que consume n8n (PLAN_API_DEFINITIVO.md, sección "Endpoints de
// automatización n8n"). Todos requieren X-API-Key (ApiKeyGuard), a
// diferencia del resto de la API que usa sesión de usuario.
@Controller("api/v1/automatizacion")
@UseGuards(ApiKeyGuard)
export class AutomatizacionController {
  constructor(
    private readonly automatizacionService: AutomatizacionService,
    private readonly tareasService: TareasService
  ) {}

  @Get("parametros")
  parametros() {
    return this.automatizacionService.obtenerParametros();
  }

  @Get("catalogos")
  catalogos() {
    return this.automatizacionService.obtenerCatalogos();
  }

  @Post("scoring")
  async scoring(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = scoringInputSchema.parse(body);
    const result = await this.automatizacionService.registrarScoring(input);
    response.status(result.ya_existia ? 200 : 201);
    return result;
  }

  @Post("incidencias")
  async incidencias(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = incidenciaInputSchema.parse(body);
    const result = await this.automatizacionService.registrarIncidencia(input);
    response.status(result.ya_existia ? 200 : 201);
    return result;
  }

  @Post("prospectos")
  async registrarProspecto(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = registroProspectoInputSchema.parse(body);
    const result = await this.automatizacionService.registrarProspecto(input);
    response.status(result.ya_existia ? 200 : 201);
    return result;
  }

  @Post("prospectos/estado")
  @HttpCode(200)
  actualizarEstadoProspecto(@Body() body: unknown) {
    const input = estadoProspectoInputSchema.parse(body);
    return this.automatizacionService.actualizarEstadoProspecto(input);
  }

  @Post("validaciones")
  @HttpCode(200)
  validarProspecto(@Body() body: unknown) {
    const input = validacionInputSchema.parse(body);
    return this.automatizacionService.validarProspecto(input);
  }

  @Post("tareas")
  async tareas(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = tareaAutomatizacionInputSchema.parse(body);
    const result = await this.tareasService.createFromAutomation(input);
    response.status(result.ya_existia ? 200 : 201);
    return result;
  }

  @Get("campanas/activa")
  campanaActiva(@Query() query: Record<string, unknown>) {
    const input = campanaActivaQuerySchema.parse(query);
    return this.automatizacionService.consultarCampanaActiva(input);
  }

  @Get("supresion")
  consultarSupresion(@Query() query: Record<string, unknown>) {
    const input = consultaSupresionQuerySchema.parse(query);
    return this.automatizacionService.consultarSupresion(input);
  }

  @Post("supresion")
  async registrarSupresion(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const input = registroSupresionInputSchema.parse(body);
    const result = await this.automatizacionService.registrarSupresion(input);
    response.status(result.ya_existia ? 200 : 201);
    return result;
  }
}
