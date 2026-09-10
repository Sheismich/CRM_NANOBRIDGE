import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import type { Response } from "express";
import { ZodError } from "zod";
import { HttpError } from "./http-error.js";

/**
 * Filtro global de excepciones. Reemplaza al errorHandler/notFound de
 * Express y al withErrorHandling/notFoundResponse de la versión en
 * Next.js, con el mismo formato de respuesta en los tres casos:
 * - HttpError propio -> { error: "request_error", message } con su status.
 * - 404 automático de Nest (ninguna ruta coincide) -> el mismo cuerpo que
 *   ya devolvía el catch-all de Express/Next.
 * - ZodError (body/query inválido) -> 400 con el detalle de campos. Esto
 *   faltaba (caía al 500 genérico) tanto en la versión de Express como en
 *   la de Next.js; se corrige aquí también.
 * - Cualquier otro error -> 500 genérico.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpError) {
      response.status(exception.status).json({ error: "request_error", message: exception.message });
      return;
    }

    if (exception instanceof ZodError) {
      response.status(400).json({ error: "validation_error", message: "Datos inválidos", details: exception.issues });
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
