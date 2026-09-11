import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, PayloadTooLargeException } from "@nestjs/common";
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

    // FileInterceptor (multer) con `limits.fileSize` lanza esto cuando el
    // archivo excede el límite -- sin este caso caía al 500 genérico de
    // abajo (PayloadTooLargeException SÍ es un HttpException, pero su
    // status 413 no es NOT_FOUND, así que no entraba al branch de arriba).
    // Se mapea a 400 para cumplir "un archivo que exceda el tamaño máximo
    // [debe ser] rechazado con 400" (PLAN_CRM_DEFINITIVO.md #8), mismo
    // contrato que ya cumple DocumentosService.validarArchivo() para el
    // caso que sí llega a bufferizarse completo (hallazgo de code review,
    // 11-sep-2026).
    if (exception instanceof PayloadTooLargeException) {
      response.status(400).json({ error: "request_error", message: "El archivo excede el tamaño máximo permitido" });
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
