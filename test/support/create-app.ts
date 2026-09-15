import cookieParser from "cookie-parser";
import express from "express";
import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module.js";
import { HttpExceptionFilter } from "../../src/shared/http-exception.filter.js";
import { env } from "../../src/config/env.js";

// Mismo bootstrap que src/main.ts (bodyParser propio, cookieParser, CORS,
// filtro global) pero SIN app.listen(): supertest habla directo con el
// handler de Express vía app.getHttpServer(), no hace falta un puerto real.
// Si main.ts cambia este bootstrap, hay que reflejarlo aquí también -- son
// solo unas líneas, no vale la pena una abstracción compartida por esto
// (hallazgo de code-review, 15-sep-2026: faltaban enableCors() y
// disable("x-powered-by"), pese a que este comentario ya afirmaba que
// reflejaba main.ts al completo).
export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());
  app.enableCors({ origin: env.CORS_ORIGINS.length > 0 ? env.CORS_ORIGINS : false, credentials: true });
  app.useGlobalFilters(new HttpExceptionFilter());
  await app.init();
  return app;
}
