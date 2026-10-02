import type { NextFunction, Request, Response } from "express";

export const CODIGO_ORIGEN_NO_PERMITIDO = "ORIGEN_NO_PERMITIDO";

const METODOS_QUE_NO_CAMBIAN_DATOS = new Set(["GET", "HEAD", "OPTIONS"]);

type Peticion = { metodo: string; origin: string | undefined; secFetchSite: string | undefined; host: string | undefined };

// Defensa contra CSRF (B9 del plan de fixes, 2-oct-2026). La cookie de
// sesión es SameSite=Lax (session.service.ts): frena a sitios ajenos, pero
// NO a otros subdominios del mismo dominio, que para el navegador son el
// "mismo sitio". Un formulario escondido en uno de ellos podía subir un
// documento o finalizar una campaña con la sesión de quien lo abriera. Los
// cuerpos JSON no salen de un formulario, pero las subidas (multipart) y
// los POST sin cuerpo sí.
//
// Toda petición que cambia datos y trae Origin (los navegadores siempre lo
// mandan en esas) pasa solo si:
// - el origen está en CORS_ORIGINS (un front en otro dominio, si un día lo hay);
// - el navegador dice Sec-Fetch-Site: same-origin (una página no puede
//   falsificar esa cabecera; cubre el front publicado con rewrite a la API);
// - o el origen coincide con el host de la API (navegadores viejos sin
//   Sec-Fetch-Site).
// Sin Origin no es un navegador (n8n, curl): no aplica. Vale también para el
// login, para que nadie te inicie sesión en una cuenta suya.
export function origenPermitido(peticion: Peticion, origenesPermitidos: readonly string[]): boolean {
  if (METODOS_QUE_NO_CAMBIAN_DATOS.has(peticion.metodo.toUpperCase())) return true;
  if (peticion.origin === undefined) return true;
  if (origenesPermitidos.includes(peticion.origin)) return true;
  if (peticion.secFetchSite === "same-origin") return true;
  try {
    return peticion.host !== undefined && new URL(peticion.origin).host === peticion.host.toLowerCase();
  } catch {
    // "null" u otra cosa que no es URL.
    return false;
  }
}

// Middleware de Express (va antes que Nest, ver configurar-app.ts): por eso
// responde él mismo con la forma de HttpExceptionFilter en vez de lanzar.
export function revisarOrigen(origenesPermitidos: readonly string[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const permitido = origenPermitido(
      { metodo: request.method, origin: request.headers.origin, secFetchSite: request.get("sec-fetch-site"), host: request.headers.host },
      origenesPermitidos
    );
    if (permitido) return next();
    response.status(403).json({ error: "request_error", message: "Origen no permitido", code: CODIGO_ORIGEN_NO_PERMITIDO });
  };
}
