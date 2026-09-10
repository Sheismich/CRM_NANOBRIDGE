import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { SessionAuthGuard } from "./guards/session-auth.guard.js";
import { RolesGuard } from "./guards/roles.guard.js";
import { ApiKeyGuard } from "./guards/api-key.guard.js";

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, SessionAuthGuard, RolesGuard, ApiKeyGuard],
  // Se exportan los guards para que otros módulos (como CrmModule) los usen
  // en @UseGuards(...) sin tener que redeclararlos.
  exports: [SessionService, SessionAuthGuard, RolesGuard, ApiKeyGuard]
})
export class AuthModule {}
