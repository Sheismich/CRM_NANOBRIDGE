import { and, desc, eq } from "drizzle-orm";
import type { DrizzleDb, DrizzleTx } from "../database/drizzle.constants.js";
import { correosRespuesta } from "../database/schema.js";

// Un prospecto está "en conversación" cuando un vendedor ya le contestó
// desde el CRM (etapa 3, caso que agregó Fabián el 20-oct-2026). Sus
// respuestas nuevas le llegan a ese vendedor en vez de ir a la cola de
// clasificación, y se pueden contestar aunque nadie las haya clasificado.
// Regresa quién le escribió la última vez, o null.
export async function vendedorDeLaConversacion(db: DrizzleDb | DrizzleTx, prospectoId: number): Promise<number | null> {
  const [ultimo] = await db
    .select({ usuarioId: correosRespuesta.usuarioId })
    .from(correosRespuesta)
    .where(and(eq(correosRespuesta.prospectoId, prospectoId), eq(correosRespuesta.estado, "enviado")))
    .orderBy(desc(correosRespuesta.id))
    .limit(1);
  return ultimo?.usuarioId ?? null;
}
