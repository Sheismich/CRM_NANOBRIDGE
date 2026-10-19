import { Module } from "@nestjs/common";
import { PlantillasController } from "./plantillas.controller.js";
import { PlantillasService } from "./plantillas.service.js";
import { AuthModule } from "../auth/auth.module.js";

@Module({
  imports: [AuthModule],
  controllers: [PlantillasController],
  providers: [PlantillasService]
})
export class PlantillasModule {}
