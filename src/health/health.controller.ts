import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import { sql } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response) {
    // Antes devolvía {status:"ok"} sin tocar la base de datos: si MySQL
    // estaba caído o el pool exhausto, este endpoint seguía respondiendo
    // 200 mientras CUALQUIER otro endpoint real daba 500 -- un
    // orquestador/load balancer configurado con esto como liveness/
    // readiness seguía mandando tráfico a una instancia que no podía
    // servir nada (hallazgo de code review, 14-sep-2026). SELECT 1 es la
    // consulta más barata posible, solo confirma que el pool puede
    // conseguir una conexión y que MySQL responde.
    //
    // Se fija el status directo en `response` (en vez de lanzar una
    // HttpException) porque HttpExceptionFilter no tiene un caso para
    // ServiceUnavailableException: cualquier HttpException que no sea
    // HttpError/ZodError/PayloadTooLarge/404 cae a su branch genérico de
    // 500, perdiendo el 503 que sí le corresponde a un healthcheck.
    try {
      await this.db.execute(sql`SELECT 1`);
    } catch (error) {
      console.error("[health] la base de datos no respondió:", error);
      response.status(503);
      return { status: "error", service: "nanobridge-crm-api", detalle: "base de datos no disponible" };
    }
    return { status: "ok", service: "nanobridge-crm-api" };
  }
}
