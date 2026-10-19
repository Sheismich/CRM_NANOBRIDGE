import { Injectable } from "@nestjs/common";
import type { CorreoSaliente, CorreoService } from "./correo.types.js";

// Pruebas y desarrollo: no manda nada, guarda lo que se mandaría. Con
// `fallar = true` simula a SendGrid caído.
@Injectable()
export class CorreoFalsoDriver implements CorreoService {
  readonly enviados: CorreoSaliente[] = [];
  fallar = false;

  async enviar(correo: CorreoSaliente) {
    if (this.fallar) throw new Error("Correo falso: falla simulada");
    this.enviados.push(correo);
    return { id: `falso-${this.enviados.length}` };
  }
}
