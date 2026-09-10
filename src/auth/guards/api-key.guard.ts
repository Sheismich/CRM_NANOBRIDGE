import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/http-error.js";

/**
 * Auth de n8n hacia la API (PLAN_API_DEFINITIVO.md, sección Arquitectura):
 * header X-API-Key comparado contra CRM_CALLBACK_API_KEY. Reemplaza al
 * requireApiKey de la versión en Express/Next.js, ahora como Guard de Nest,
 * igual patrón que SessionAuthGuard pero sin sesión ni request.currentUser.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.header("x-api-key");
    if (!provided || !safeEqual(provided, env.CRM_CALLBACK_API_KEY)) {
      throw new HttpError(401, "API key inválida o ausente");
    }
    return true;
  }
}

function safeEqual(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) {
    // Compara contra sí mismo para no filtrar por timing si las longitudes difieren.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
