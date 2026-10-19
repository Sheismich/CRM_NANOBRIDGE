export const IA_SERVICE = Symbol("IA_SERVICE");

// Una pregunta a la IA que debe contestar en JSON con la forma de
// `esquema` (responseSchema de Gemini: type OBJECT/STRING/INTEGER...).
// La usan las etapas 3 (borrador de respuesta) y 4 (resumen de la ficha).
export type PreguntaIa = {
  instrucciones: string;
  texto: string;
  esquema: Record<string, unknown>;
};

export interface IaService {
  // Lanza error si la IA falla o no contesta un JSON válido.
  generarJson<T>(pregunta: PreguntaIa): Promise<T>;
}
