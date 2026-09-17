import { Inject, Injectable } from "@nestjs/common";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { obtenerCatalogosEnum } from "../shared/catalogos-enum.js";

@Injectable()
export class CatalogosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  async obtenerCatalogos() {
    return obtenerCatalogosEnum(this.db);
  }
}
