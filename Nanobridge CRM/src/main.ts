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
  app.useGlobalFilters(new HttpExceptionFilter());

  await app.listen(env.PORT);
  console.log(`Nanobridge CRM API listening on port ${env.PORT}`);
}

await bootstrap();
