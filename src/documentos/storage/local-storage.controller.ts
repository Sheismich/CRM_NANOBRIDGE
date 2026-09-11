import { Controller, Get, Query, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { contentDispositionAdjunto } from "../../shared/content-disposition.js";
import { LocalStorageDriver } from "./local-storage.driver.js";

const tokenQuerySchema = z.object({ token: z.string().min(1) });

/**
 * Sirve las descargas del driver local a partir de la "URL firmada" que
 * genera LocalStorageDriver.urlFirmada() -- sin bucket real, esta ruta hace
 * las veces de la URL firmada de GCS. Deliberadamente SIN SessionAuthGuard:
 * la autorización ya se validó (scoping por empresa) y quedó auditada
 * (acción "descargar") en DocumentosService.obtenerUrlDescarga() al emitir
 * el token -- el propio token, firmado y de corta duración
 * (STORAGE_SIGNED_URL_TTL_SECONDS), es la credencial de esta ruta, igual
 * que una URL firmada real de GCS tampoco pide sesión.
 */
@Controller("api/v1/storage/local")
export class LocalStorageController {
  constructor(private readonly localStorageDriver: LocalStorageDriver) {}

  @Get("descarga")
  async descargar(@Query() query: Record<string, unknown>, @Res() response: Response) {
    const { token } = tokenQuerySchema.parse(query);
    const { buffer, nombreArchivo, mimeType } = await this.localStorageDriver.leerParaDescarga(token);
    response.status(200).set({
      "Content-Type": mimeType,
      "Content-Disposition": contentDispositionAdjunto(nombreArchivo),
      "Content-Length": String(buffer.length)
    }).send(buffer);
  }
}
