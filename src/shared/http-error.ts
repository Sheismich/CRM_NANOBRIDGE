// `code`: identificador fijo y opcional para los errores que una pantalla
// necesita distinguir sin comparar el texto del mensaje (que puede cambiar
// de redacción). `headers`: cabeceras de respuesta opcionales (p. ej.
// Retry-After en un 429). El filtro global agrega los dos solo cuando
// vienen; el resto de errores no cambia de forma.
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly headers?: Record<string, string>) {
    super(message);
  }
}
