/**
 * Interfaz abstracta del expediente documental (PLAN_CRM_DEFINITIVO.md #8:
 * "Archivos en Google Cloud Storage privado... URL firmadas de corta
 * duración para descarga"). DocumentosService solo conoce esta interfaz,
 * nunca el driver concreto -- storage.provider.ts decide con qué
 * implementación (local-storage.driver.ts o gcs-storage.driver.ts) se
 * satisface @Inject(STORAGE_SERVICE) según STORAGE_DRIVER.
 */

export type ArchivoParaSubir = {
  buffer: Buffer;
  mimeType: string;
  tamanoBytes: number;
};

export type OpcionesUrlFirmada = {
  /** Nombre original del archivo, usado para el Content-Disposition de la descarga. */
  nombreArchivo: string;
  mimeType: string;
  ttlSegundos: number;
};

export interface StorageService {
  /** Sube el archivo bajo `key` (la storage_key que se persiste en `documentos`). */
  subir(key: string, archivo: ArchivoParaSubir): Promise<void>;
  /** Genera una URL de descarga de corta duración para `key`. */
  urlFirmada(key: string, opciones: OpcionesUrlFirmada): Promise<string>;
  /**
   * Borra el objeto de storage subyacente. La interfaz lo expone para un
   * futuro job de purga por política de retención; DocumentosService no lo
   * invoca todavía (ver comentario de `activo` en 014_documentos.sql --
   * el borrado hoy es lógico, no purga el archivo).
   */
  eliminar(key: string): Promise<void>;
}
