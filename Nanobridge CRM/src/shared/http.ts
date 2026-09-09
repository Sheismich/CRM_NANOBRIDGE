import type { NextFunction, Request, Response } from "express";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

export function notFound(_request: Request, response: Response) {
  response.status(404).json({ error: "not_found", message: "Ruta no encontrada" });
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  if (error instanceof HttpError) {
    response.status(error.status).json({ error: "request_error", message: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ error: "internal_error", message: "Error interno" });
}
