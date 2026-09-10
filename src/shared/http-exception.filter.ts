import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { HttpError } from "./http-error.js";

/**
 * Filtro global de excepciones. Reemplaza al errorHandler/notFound de
 * Express y al withErrorHandling/notFoundResponse de la versión en
 * Next.js, con el mismo formato de respuesta en los tres casos:
 * - HttpError propio -> { error: "request_error", message } con su status.
 * - 404 automático de Nest (ninguna ruta coincide) -> el mismo cuerpo que
 *   ya devolvía el catch-all de Express/Next.
 * - Cualquier otro error (incluida una validación de Zod fallida) -> 500
 *   genérico, igual que las versiones anteriores.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpError) {
      response.status(exception.status).json({ error: "request_error", message: exception.message });
      return;
    }

    if (exception instanceof HttpException && exception.getStatus() === HttpStatus.NOT_FOUND) {
      response.status(404).json({ error: "not_found", message: "Ruta no encontrada" });
      return;
    }

    console.error(exception);
    response.status(500).json({ error: "internal_error", message: "Error interno" });
  }
}
