import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { env } from "../../config/env.js";
import { HttpError } from "../../shared/http-error.js";
import type { ArchivoParaSubir, OpcionesUrlFirmada, StorageService } from "./storage.types.js";

type TokenPayload = { k: string; n: string; m: string; e: number };

/**
 * Driver local (default, dev/sin credenciales de GCS): guarda los archivos
 * en disco bajo STORAGE_LOCAL_DIR y genera "URLs firmadas" propias, porque
 * no hay un bucket real que las emita -- un token HMAC-SHA256 de corta
 * duración (STORAGE_SIGNED_URL_TTL_SECONDS) sobre la key, el nombre
 * original y el mime type, resuelto por
 * LocalStorageController (GET /api/v1/storage/local/descarga).
 *
 * Se registra como provider concreto SIEMPRE (independiente de
 * STORAGE_DRIVER) para que LocalStorageController pueda validar y servir
 * un token ya emitido aunque el driver activo para subidas nuevas sea
 * 'gcs' -- ver storage.provider.ts.
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

  async urlFirmada(key: string, opciones: OpcionesUrlFirmada): Promise<string> {
    const expira = Math.floor(Date.now() / 1000) + opciones.ttlSegundos;
    const token = this.firmar({ k: key, n: opciones.nombreArchivo, m: opciones.mimeType, e: expira });
    // Ruta relativa (no hay bucket ni dominio propio que devolver) -- el
    // cliente la resuelve contra el origen de esta misma API, igual que
    // cualquier otra ruta de /api/v1.
    return `/api/v1/storage/local/descarga?token=${encodeURIComponent(token)}`;
  }

  async eliminar(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }

  /** Usado por LocalStorageController para servir el archivo de un token válido. */
  async leerParaDescarga(token: string): Promise<{ buffer: Buffer; nombreArchivo: string; mimeType: string }> {
    const payload = this.verificar(token);
    let buffer: Buffer;
    try {
      buffer = await readFile(this.resolvePath(payload.k));
    } catch (error) {
      // Token todavía vigente (TTL sin expirar) pero el blob ya no está en
      // disco (limpieza manual, STORAGE_LOCAL_DIR movido, etc.) -- sin este
      // catch, el ENOENT crudo no lo reconoce HttpExceptionFilter y cae al
      // 500 genérico en vez del 404 que corresponde (hallazgo de code
      // review, 11-sep-2026).
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new HttpError(404, "El archivo ya no está disponible");
      }
      throw error;
    }
    return { buffer, nombreArchivo: payload.n, mimeType: payload.m };
  }

  private firmar(payload: TokenPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const firma = createHmac("sha256", env.STORAGE_LOCAL_SIGNING_SECRET).update(encoded).digest("base64url");
    return `${encoded}.${firma}`;
  }

  private verificar(token: string): TokenPayload {
    const [encoded, firma] = token.split(".");
    if (!encoded || !firma) throw new HttpError(400, "Token de descarga inválido");

    const firmaEsperada = createHmac("sha256", env.STORAGE_LOCAL_SIGNING_SECRET).update(encoded).digest("base64url");
    // timingSafeEqual exige buffers del mismo largo -- comparar largos
    // primero evita filtrar tiempo de respuesta y evita que un token
    // truncado reviente con un throw de longitud distinta.
    const firmaBuf = Buffer.from(firma);
    const esperadaBuf = Buffer.from(firmaEsperada);
    if (firmaBuf.length !== esperadaBuf.length || !timingSafeEqual(firmaBuf, esperadaBuf)) {
      throw new HttpError(400, "Token de descarga inválido");
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TokenPayload;
    } catch {
      throw new HttpError(400, "Token de descarga inválido");
    }

    if (Math.floor(Date.now() / 1000) > payload.e) {
      throw new HttpError(400, "El enlace de descarga expiró, solicita uno nuevo");
    }
    return payload;
  }
}
