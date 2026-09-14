import cookieParser from "cookie-parser";
import express from "express";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { HttpExceptionFilter } from "./shared/http-exception.filter.js";
import { env } from "./config/env.js";

async function bootstrap() {
  // bodyParser: false porque montamos express.json() nosotros mismos, con el
  // mismo límite de 1mb que tenía la versión en Express puro (algo que en la
  // versión de Next.js quedó pendiente por no tener acceso directo al
  // servidor http subyacente).
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  // CORS_ORIGINS vacío (default) => origin:false: ningún navegador puede
  // llamar la API desde otro origen, pero n8n (X-API-Key) y curl no son
  // peticiones de navegador y no pasan por CORS -- no se rompen.
  // credentials:true es obligatorio para que el navegador mande la cookie
  // de sesión en fetch/XHR cross-origin; con eso, `origin` no puede ser
  // "*" (spec de CORS), de ahí la whitelist explícita en vez de comodín.
  app.enableCors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(env.PORT);
  console.log(`Nanobridge CRM API listening on port ${env.PORT}`);
}

await bootstrap();
