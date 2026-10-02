import { Test } from "@nestjs/testing";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "../../src/app.module.js";
import { configurarApp } from "../../src/shared/configurar-app.js";

// Mismo armado que src/main.ts (configurarApp) pero SIN app.listen():
// supertest habla directo con el handler de Express vía
// app.getHttpServer(), no hace falta un puerto real.
export async function createTestApp() {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  configurarApp(app);
  await app.init();
  return app;
}
