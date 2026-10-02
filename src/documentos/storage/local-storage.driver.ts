import { Injectable } from "@nestjs/common";
import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/http-error.js";
import type { ArchivoLeido, ArchivoParaSubir, StorageService } from "./storage.types.js";

/**
 * Driver local (default, dev/sin credenciales de GCS): guarda los archivos
 * en disco bajo STORAGE_LOCAL_DIR. La descarga la sirve
 * DocumentosController con leer(), igual que con GCS.
 *
 * Se registra como provider concreto SIEMPRE (independiente de
 * STORAGE_DRIVER) -- ver storage.provider.ts.
 */
@Injectable()
export class LocalStorageDriver implements StorageService {
  private readonly baseDir = resolve(env.STORAGE_LOCAL_DIR);

  private resolvePath(key: string): string {
    const target = resolve(this.baseDir, key);
    // La key la construye DocumentosService (no llega tal cual del
    // cliente), pero se valida igual que no escape STORAGE_LOCAL_DIR vía
    // "../" -- defensa en profundidad.
    if (target !== this.baseDir && !target.startsWith(this.baseDir + sep)) {
      throw new HttpError(400, "Ruta de almacenamiento inválida");
    }
    return target;
  }

  async subir(key: string, archivo: ArchivoParaSubir): Promise<void> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, archivo.buffer);
    } catch (error) {
      // Si writeFile truena a medias (disco lleno, proceso matado, etc.)
      // puede quedar un archivo truncado/corrupto en `path` sin ninguna
      // fila en `documentos` que lo referencie -- distinto del caso ya
      // documentado de "blob huérfano" (documentos.service.ts), que
      // asume una escritura COMPLETA y exitosa seguida de un fallo en el
      // insert a MySQL. Aquí se intenta limpiar ese archivo a medio
      // escribir antes de propagar el error (hallazgo de code review,
      // 14-sep-2026); si el propio rm también falla (ej. el mismo disco
      // lleno que causó el problema original), no hay nada más que hacer
      // desde aquí -- se deja rastro y se propaga el error original.
      await rm(path, { force: true }).catch((rmError) => {
        console.error(`[local-storage] no se pudo limpiar el archivo parcial ${path}:`, rmError);
      });
      throw error;
    }
  }

  async leer(key: string): Promise<ArchivoLeido> {
    const path = this.resolvePath(key);
    try {
      const { size } = await stat(path);
      return { stream: createReadStream(path), tamanoBytes: size };
    } catch (error) {
      // Sin este catch, el ENOENT crudo cae al 500 genérico en vez del 404
      // que corresponde (hallazgo de code review, 11-sep-2026).
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "El archivo ya no está disponible");
      }
      throw error;
    }
  }

  async eliminar(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }
}
