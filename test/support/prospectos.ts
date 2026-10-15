import { and, eq } from "drizzle-orm";
import { prospectos } from "../../src/database/schema.js";
import type { testDb } from "./db.js";

// Desde el 15-oct-2026 POST /automatizacion/envios solo acepta prospectos
// validados (n8n valida antes de mandar). Las pruebas que registran un
// prospecto y le mandan correo de inmediato lo validan así primero. Solo
// toca a los "capturado": un estado puesto a propósito por la prueba
// (baja, inactivo...) se respeta.
export async function validarParaEnvio(db: ReturnType<typeof testDb>, prospectoId: number) {
  await db.update(prospectos).set({ estado: "validado" }).where(and(eq(prospectos.id, prospectoId), eq(prospectos.estado, "capturado")));
}
