import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DRIZZLE, type DrizzleDb } from "../database/drizzle.constants.js";
import { prospectos } from "../database/schema.js";
import { darDeBajaPersona, personaEnBaja } from "../shared/baja-prospecto.js";
import { leerTokenDeBaja } from "../shared/link-baja.js";
import { suprimirMediosDeContacto } from "../shared/supresion.js";
import type { VistaBaja } from "./pagina-baja.js";

export const MOTIVO_BAJA_EN_PAGINA = "Baja confirmada en la página de baja";

// Página de baja propia (13-nov-2026). El link del correo va firmado
// (shared/link-baja.ts) y no pide sesión: quien tiene el link es quien
// recibió el correo.
@Injectable()
export class BajaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDb) {}

  // Abrir el link (GET): solo lee. Los escáneres de links de los servidores
  // de correo (Microsoft 365) abren todos los links de un correo al
  // recibirlo; por eso aquí NUNCA se cambia nada.
  async abrir(token: string): Promise<VistaBaja> {
    const contactoId = await this.persona(token);
    if (contactoId === null) return "invalido";
    return (await personaEnBaja(this.db, contactoId)) ? "listo" : "confirmar";
  }

  // Apretar el botón (POST): lo mismo que el link de baja de antes y que la
  // baja desde la ficha (ContactosService.darDeBaja): todos los medios de la
  // persona a la lista de supresión, sus prospectos a baja y sus
  // seguimientos cancelados, en una transacción y en ese orden. Repetirlo
  // no duplica nada. Queda en el Historial como cambio de estado de la
  // automatización, con su propio motivo.
  async confirmar(token: string): Promise<VistaBaja> {
    const contactoId = await this.persona(token);
    if (contactoId === null) return "invalido";
    await this.db.transaction(async (tx) => {
      const origen = { motivo: MOTIVO_BAJA_EN_PAGINA, executionId: null, usuarioId: null };
      await suprimirMediosDeContacto(tx, contactoId, origen);
      await darDeBajaPersona(tx, contactoId, { accion: "cambiar_estado_automatizacion", ...origen });
    });
    return "listo";
  }

  private async persona(token: string): Promise<number | null> {
    const prospectoId = leerTokenDeBaja(token);
    if (prospectoId === null) return null;
    const [fila] = await this.db.select({ contactoId: prospectos.contactoId }).from(prospectos).where(eq(prospectos.id, prospectoId)).limit(1);
    return fila?.contactoId ?? null;
  }
}
