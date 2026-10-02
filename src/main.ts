import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { configurarApp } from "./shared/configurar-app.js";
import { env } from "./config/env.js";

async function bootstrap() {
  // bodyParser: false porque configurarApp() monta express.json() con su
  // propio límite de 1mb.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  configurarApp(app);

  await app.listen(env.PORT);
  console.log(`Nanobridge CRM API listening on port ${env.PORT}`);
}

await bootstrap();
