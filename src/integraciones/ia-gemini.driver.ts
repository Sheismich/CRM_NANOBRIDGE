import { Injectable } from "@nestjs/common";
import { env } from "../config/env.js";
import type { IaService, PreguntaIa } from "./ia.types.js";

const TIEMPO_MAXIMO_MS = 20000;

// Gemini generateContent con fetch y responseSchema, para que conteste JSON
// con la forma pedida. La llave es del proyecto de pago (Google no entrena
// con esos datos).
@Injectable()
export class IaGeminiDriver implements IaService {
  async generarJson<T>(pregunta: PreguntaIa): Promise<T> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(env.GEMINI_MODELO)}:generateContent`;
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "x-goog-api-key": env.GEMINI_API_KEY ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: pregunta.instrucciones }] },
        contents: [{ role: "user", parts: [{ text: pregunta.texto }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: pregunta.esquema }
      }),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS)
    });
    if (!respuesta.ok) {
      const detalle = (await respuesta.text().catch(() => "")).slice(0, 300);
      throw new Error(`Gemini respondió ${respuesta.status}: ${detalle}`);
    }
    const datos = await respuesta.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const texto = datos.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!texto) throw new Error("Gemini no regresó texto");
    return JSON.parse(texto) as T;
  }
}
