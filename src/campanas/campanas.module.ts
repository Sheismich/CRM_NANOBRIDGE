import { Module } from "@nestjs/common";
import { CampanasController } from "./campanas.controller.js";
import { CampanasService } from "./campanas.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [CampanasController],
  providers: [CampanasService]
})
export class CampanasModule {}
