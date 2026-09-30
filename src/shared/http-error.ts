// `code`: identificador fijo y opcional para los errores que una pantalla
// necesita distinguir sin comparar el texto del mensaje (que puede cambiar
// de redacción). El filtro global lo agrega a la respuesta solo cuando
// viene; el resto de errores no cambia de forma.
export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) {
    super(message);
  }
}
