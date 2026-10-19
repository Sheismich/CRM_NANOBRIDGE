import { Injectable } from "@nestjs/common";
import type { IaService, PreguntaIa } from "./ia.types.js";

// Pruebas y desarrollo: no llama a Gemini. Guarda las preguntas y contesta
// lo que se le ponga en `respuesta` (o falla con `fallar = true`).
@Injectable()
export class IaFalsaDriver implements IaService {
  readonly preguntas: PreguntaIa[] = [];
  respuesta: unknown = {};
  fallar = false;

  async generarJson<T>(pregunta: PreguntaIa): Promise<T> {
    this.preguntas.push(pregunta);
    if (this.fallar) throw new Error("IA falsa: falla simulada");
    return this.respuesta as T;
  }
}
