import { Injectable } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import { env } from "../../config/env.js";
import { contentDispositionAdjunto } from "../../shared/content-disposition.js";
import type { ArchivoParaSubir, OpcionesUrlFirmada, StorageService } from "./storage.types.js";

/**
 * Driver real de Google Cloud Storage (PLAN_CRM_DEFINITIVO.md #8:
 * "Archivos en Google Cloud Storage privado... URL firmadas de corta
 * duración para descarga"), implementado según la documentación oficial de
 * @google-cloud/storage (Storage.bucket(...).file(...).save/getSignedUrl).
 *
 * NO se pudo probar en este entorno: no existe un proyecto ni bucket de
 * GCS configurado, ni credenciales (ADC o cuenta de servicio) disponibles.
 * Queda seleccionable con STORAGE_DRIVER=gcs para cuando el usuario
 * aprovisione un bucket real.
 */
@Injectable()
export class GcsStorageDriver implements StorageService {
  // Instancia perezosa: @google-cloud/storage intenta resolver
  // Application Default Credentials en cuanto se construye `new
  // Storage(...)`, y este provider se instancia siempre (storage.provider.ts
  // registra ambos drivers en el árbol de DI, no solo el activo) -- no debe
  // tronar el arranque de la app cuando STORAGE_DRIVER=local (el default,
  // sin credenciales de GCS en este entorno) ni cuando falten GCS_* en dev.
  private storageClient: Storage | undefined;

  private get client(): Storage {
    if (!this.storageClient) {
      this.storageClient = new Storage({
        projectId: env.GCS_PROJECT_ID,
        keyFilename: env.GCS_KEY_FILE
      });
    }
    return this.storageClient;
  }

  private get bucket() {
    // env.superRefine ya exige GCS_BUCKET cuando STORAGE_DRIVER=gcs, así
    // que este throw solo dispara si alguien invoca el driver sin haberlo
    // seleccionado (no debería ocurrir vía storage.provider.ts).
    if (!env.GCS_BUCKET) throw new Error("GCS_BUCKET no está configurado");
    return this.client.bucket(env.GCS_BUCKET);
  }

  async subir(key: string, archivo: ArchivoParaSubir): Promise<void> {
    // Bucket privado por definición del plan: nunca se llama a
    // makePublic() ni se sube con predefinedAcl público. El único acceso
    // de lectura es vía urlFirmada().
    await this.bucket.file(key).save(archivo.buffer, {
      contentType: archivo.mimeType,
      resumable: false
    });
  }

  async urlFirmada(key: string, opciones: OpcionesUrlFirmada): Promise<string> {
    const [url] = await this.bucket.file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + opciones.ttlSegundos * 1000,
      // contentDispositionAdjunto() escapa comillas/backslashes del nombre
      // original -- sin esto, un nombre de archivo con una comilla
      // literal rompía la cadena del header e inyectaba atributos
      // adicionales en la respuesta que GCS sirve a cada descarga
      // (hallazgo de code review, 11-sep-2026).
      responseDisposition: contentDispositionAdjunto(opciones.nombreArchivo),
      responseType: opciones.mimeType
    });
    return url;
  }

  async eliminar(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}
