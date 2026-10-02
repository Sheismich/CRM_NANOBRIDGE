import { Injectable } from "@nestjs/common";
import { Storage } from "@google-cloud/storage";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/http-error.js";
import type { ArchivoLeido, ArchivoParaSubir, StorageService } from "./storage.types.js";

/**
 * Driver real de Google Cloud Storage (PLAN_CRM_DEFINITIVO.md #8:
 * "Archivos en Google Cloud Storage privado"), implementado según la
 * documentación oficial de @google-cloud/storage
 * (Storage.bucket(...).file(...).save/getMetadata/createReadStream).
 *
 * Es el driver de producción (STORAGE_DRIVER=gcs). Los tests corren con el
 * driver local: aquí no hay bucket ni credenciales.
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
    // de lectura es vía leer(), desde la propia API.
    await this.bucket.file(key).save(archivo.buffer, {
      contentType: archivo.mimeType,
      resumable: false
    });
  }

  // Antes era una URL firmada v4 (B6 del plan de fixes, 2-oct-2026): en
  // Cloud Run firmar necesita iam.serviceAccounts.signBlob, que la cuenta de
  // servicio no tenía, y toda descarga daba 500. Ahora solo se lee el objeto,
  // que roles/storage.objectAdmin sobre el bucket ya permite.
  // getMetadata() va primero para responder 404 antes de mandar cabeceras y
  // para tener el tamaño (Content-Length).
  async leer(key: string): Promise<ArchivoLeido> {
    const archivo = this.bucket.file(key);
    let tamano: string | number | undefined;
    try {
      [{ size: tamano }] = await archivo.getMetadata();
    } catch (error) {
      if ((error as { code?: number }).code === 404) throw new HttpError(404, "El archivo ya no está disponible");
      throw error;
    }
    return { stream: archivo.createReadStream(), tamanoBytes: Number(tamano) };
  }

  async eliminar(key: string): Promise<void> {
    await this.bucket.file(key).delete({ ignoreNotFound: true });
  }
}
