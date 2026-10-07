import cookieParser from "cookie-parser";
import express from "express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { HttpExceptionFilter } from "./http-exception.filter.js";
import { revisarOrigen } from "./origen-csrf.js";
import { env } from "../config/env.js";
import { HttpError } from "./http-error.js";
import { esUtf8Valido } from "./texto.js";

// El armado de la app, compartido por src/main.ts y los tests
// (test/support/create-app.ts). Antes eran dos copias "a mano" y se
// desincronizaron varias veces (faltaron enableCors y x-powered-by en los
// tests, 15-sep-2026; luego exposedHeaders, 2-oct-2026): los tests probaban
// una app distinta a la de producción.
export function configurarApp(app: NestExpressApplication) {
  app.disable("x-powered-by");
  // Ver TRUST_PROXY en config/env.ts: sin esto, request.ip (que usa
  // RateLimitGuard) es la IP del proxy para todo el tráfico real cuando la
  // API corre detrás de uno.
  if (env.TRUST_PROXY) app.set("trust proxy", 1);
  // Antes de leer el cuerpo: una petición de otro origen se rechaza sin
  // procesarla (ver origen-csrf.ts).
  app.use(revisarOrigen(env.CORS_ORIGINS));
  // bodyParser: false al crear la app (main.ts) porque el cuerpo se lee
  // aquí, con límite de 1mb. Un cuerpo que no es UTF-8 se rechaza: antes los
  // bytes que no se entendían se guardaban como "�" sin avisar (así quedó el
  // primer admin, "Fabi�n", creado desde una terminal; 7-oct-2026).
  app.use(express.json({
    limit: "1mb",
    verify: (_req, _res, bytes) => {
      if (!esUtf8Valido(bytes)) throw new HttpError(400, "El texto no viene en UTF-8 y los acentos llegarían rotos; mándalo como UTF-8", "TEXTO_NO_UTF8");
    }
  }));
  app.use(cookieParser());
  // CORS_ORIGINS vacío (default) => origin:false: ningún navegador puede
  // llamar la API desde otro origen, pero n8n (X-API-Key) y curl no son
  // peticiones de navegador y no pasan por CORS -- no se rompen.
  // credentials:true es obligatorio para que el navegador mande la cookie
  // de sesión en fetch/XHR cross-origin; con eso, `origin` no puede ser
  // "*" (spec de CORS), de ahí la whitelist explícita en vez de comodín.
  // exposedHeaders: sin él, un front en otro origen no puede leer el nombre
  // del archivo de una descarga (GET /documentos/:id/descarga).
  app.enableCors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false, credentials: true, exposedHeaders: ["Content-Disposition"] });
  app.useGlobalFilters(new HttpExceptionFilter());
}
