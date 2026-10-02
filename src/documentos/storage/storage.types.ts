/**
 * Interfaz abstracta del expediente documental (PLAN_CRM_DEFINITIVO.md #8:
 * "Archivos en Google Cloud Storage privado"). Las descargas NO usan URL
 * firmada (B6 del plan de fixes, 2-oct-2026): la API lee el archivo con
 * leer() y lo manda ella misma, con la sesión del usuario.
 * DocumentosService solo conoce esta interfaz, nunca el driver concreto --
 * storage.provider.ts decide con qué
 * implementación (local-storage.driver.ts o gcs-storage.driver.ts) se
 * satisface @Inject(STORAGE_SERVICE) según STORAGE_DRIVER.
 */

import type { Readable } from "node:stream";

export type ArchivoParaSubir = {
  buffer: Buffer;
  mimeType: string;
  tamanoBytes: number;
};

export type ArchivoLeido = {
  stream: Readable;
  tamanoBytes: number;
};

export interface StorageService {
  /** Sube el archivo bajo `key` (la storage_key que se persiste en `documentos`). */
  subir(key: string, archivo: ArchivoParaSubir): Promise<void>;
  /**
   * Abre `key` para leerlo. Si el objeto no existe lanza HttpError 404
   * ANTES de devolver el stream, para que la respuesta todavía pueda ser un
   * 404 y no una descarga cortada a medias.
   */
  leer(key: string): Promise<ArchivoLeido>;
  /**
   * Borra el objeto de storage subyacente. La interfaz lo expone para un
   * futuro job de purga por política de retención; DocumentosService no lo
   * invoca todavía (ver comentario de `activo` en 014_documentos.sql --
   * el borrado hoy es lógico, no purga el archivo).
   */
  eliminar(key: string): Promise<void>;
}
