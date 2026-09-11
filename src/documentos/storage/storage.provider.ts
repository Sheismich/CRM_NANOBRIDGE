import type { Provider } from "@nestjs/common";
import { env } from "../../config/env.js";
import { STORAGE_SERVICE } from "./storage.constants.js";
import { LocalStorageDriver } from "./local-storage.driver.js";
import { GcsStorageDriver } from "./gcs-storage.driver.js";

/**
 * Selección de driver por variable de entorno (STORAGE_DRIVER=local|gcs),
 * como pide la tarea. Ambos drivers se registran siempre en el módulo (ver
 * documentos.module.ts) -- este provider solo decide cuál de los dos
 * satisface @Inject(STORAGE_SERVICE); LocalStorageDriver además se usa
 * directo (no vía STORAGE_SERVICE) desde LocalStorageController para poder
 * servir descargas locales aunque el driver activo para subidas nuevas sea
 * 'gcs'.
 */
export const storageServiceProvider: Provider = {
  provide: STORAGE_SERVICE,
  useFactory: (local: LocalStorageDriver, gcs: GcsStorageDriver) => (env.STORAGE_DRIVER === "gcs" ? gcs : local),
  inject: [LocalStorageDriver, GcsStorageDriver]
};
