import { Module } from "@nestjs/common";
import { DocumentosController } from "./documentos.controller.js";
import { DocumentosService } from "./documentos.service.js";
import { LocalStorageController } from "./storage/local-storage.controller.js";
import { LocalStorageDriver } from "./storage/local-storage.driver.js";
import { GcsStorageDriver } from "./storage/gcs-storage.driver.js";
import { storageServiceProvider } from "./storage/storage.provider.js";
import { AuthModule } from "../auth/auth.module.js";
import { OutboxModule } from "../outbox/outbox.module.js";

@Module({
  imports: [AuthModule, OutboxModule],
  controllers: [DocumentosController, LocalStorageController],
  // LocalStorageDriver y GcsStorageDriver se registran los dos siempre;
  // storageServiceProvider (STORAGE_SERVICE) decide cuál de los dos
  // inyecta DocumentosService según STORAGE_DRIVER. LocalStorageController
  // pide LocalStorageDriver directo (no vía STORAGE_SERVICE) para poder
  // servir descargas locales ya emitidas aunque el driver activo para
  // subidas nuevas sea 'gcs'.
  providers: [DocumentosService, LocalStorageDriver, GcsStorageDriver, storageServiceProvider]
})
export class DocumentosModule {}
