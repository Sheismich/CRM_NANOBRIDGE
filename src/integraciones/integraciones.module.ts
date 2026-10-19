import { Module } from "@nestjs/common";
import { env } from "../config/env.js";
import { CORREO_SERVICE } from "./correo.types.js";
import { IA_SERVICE } from "./ia.types.js";
import { CorreoSendgridDriver } from "./correo-sendgrid.driver.js";
import { CorreoFalsoDriver } from "./correo-falso.driver.js";
import { IaGeminiDriver } from "./ia-gemini.driver.js";
import { IaFalsaDriver } from "./ia-falsa.driver.js";

// SendGrid y Gemini llamados directo desde la API (etapa 2 de las mejoras,
// 19-oct-2026). Mismo patrón que documentos/storage/storage.provider.ts:
// los dos drivers se registran siempre y la variable de entorno decide
// cuál responde a @Inject(CORREO_SERVICE) / @Inject(IA_SERVICE).
@Module({
  providers: [
    CorreoSendgridDriver,
    CorreoFalsoDriver,
    IaGeminiDriver,
    IaFalsaDriver,
    {
      provide: CORREO_SERVICE,
      useFactory: (real: CorreoSendgridDriver, falso: CorreoFalsoDriver) => (env.CORREO_DRIVER === "sendgrid" ? real : falso),
      inject: [CorreoSendgridDriver, CorreoFalsoDriver]
    },
    {
      provide: IA_SERVICE,
      useFactory: (real: IaGeminiDriver, falsa: IaFalsaDriver) => (env.IA_DRIVER === "gemini" ? real : falsa),
      inject: [IaGeminiDriver, IaFalsaDriver]
    }
  ],
  exports: [CORREO_SERVICE, IA_SERVICE]
})
export class IntegracionesModule {}
